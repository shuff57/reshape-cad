//! The single place a solved sketch's wires become `build::ProfileSeg` loops.
//! Future curve kinds (conics, splines) are added here, in the WireSeg to
//! ProfileSeg conversion, rather than in wasm.rs.

use crate::build;
use serde_json::Value;

/// The profile outline in plane (u, v) coordinates after rounds/chamfers are
/// applied -- the JS outlineOf()/tessellate() semantics. A bulge on an edge
/// becomes a genuine circular arc, kept exact as centre/radius/start/sweep, so
/// the extruded wall is a partial cylinder and the volume is exact. Returns
/// None for a circle sketch (its own path) or a collapsed outline.
thread_local! {
    /// The wire refusal sentence from the last soup extrude attempt, when the
    /// soup arm refused. The extrude/pocket arms read it to per-feature-refuse
    /// with the same sentence the session would have shown. None clears it.
    pub(crate) static LAST_PRISM_REFUSAL: std::cell::RefCell<Option<String>> =
        const { std::cell::RefCell::new(None) };
}

/// The soup arm of extruded_profile: solve the sketch's geoms+rules through
/// the sketch session, then extrude the DISCOVERED loops (SPEC-sketcher2
/// §5.3, §8.2) -- the outline first, then every hole through it. Returns None
/// and leaves a sentence in LAST_PRISM_REFUSAL when the sketch cannot be
/// trusted (conflicting rules, wire discovery refusal); the legacy `points`
/// path never touches this thread_local.
pub(crate) fn soup_profile(sk: &Value) -> Option<(Vec<Vec<build::ProfileSeg>>, Vec<(String, usize)>)> {
    let session = solved_session(sk)?;
    match session.profile() {
        Ok(loops) => {
            let out = profile_loops(&loops)?;
            let nseg: usize = out.iter().map(|l| l.len()).sum();
            let roles = (0..nseg).map(|i| ("edge".to_string(), i)).collect();
            Some((out, roles))
        }
        Err(r) => {
            LAST_PRISM_REFUSAL.with(|lr| *lr.borrow_mut() = Some(r.sentence));
            None
        }
    }
}

/// A sketch with several shapes, as separate pieces: each region is its outline first, then the loops cut out of
/// it. One region is exactly what `soup_profile` gives. None (with a sentence in LAST_PRISM_REFUSAL) when the
/// sketch cannot be trusted.
pub(crate) fn soup_regions(sk: &Value) -> Option<Vec<Vec<Vec<build::ProfileSeg>>>> {
    let session = solved_session(sk)?;
    match session.profile_regions() {
        Ok(regions) => {
            let mut out = Vec::with_capacity(regions.len());
            for r in &regions {
                out.push(profile_loops(r)?);
            }
            Some(out)
        }
        Err(r) => {
            LAST_PRISM_REFUSAL.with(|lr| *lr.borrow_mut() = Some(r.sentence));
            None
        }
    }
}

/// Open the sketch's rows and solve them from the rows themselves; a refusal leaves its sentence behind.
fn solved_session(sk: &Value) -> Option<crate::sketch::session::SketchSession> {
    LAST_PRISM_REFUSAL.with(|lr| *lr.borrow_mut() = None);
    let json = sk.to_string();
    let mut session = match crate::sketch::session::SketchSession::open(&json) {
        Ok(s) => s,
        Err(e) => {
            LAST_PRISM_REFUSAL.with(|lr| *lr.borrow_mut() = Some(e));
            return None;
        }
    };
    // Solve from the rows themselves (the seed). A solve failure is a refusal
    // too: LM refusing a sketch whose rows cannot be satisfied is honest, and
    // the diagnosis sentence is what the UI would show.
    if session.solve(&[], None).is_err() {
        LAST_PRISM_REFUSAL.with(|lr| {
            *lr.borrow_mut() = Some(
                "the sketch's rules cannot be solved; resolve the conflict first".to_string(),
            )
        });
        return None;
    }
    if let Ok(d) = session.diagnose() {
        if d.bucket == crate::sketch::solve::Bucket::Conflicting {
            LAST_PRISM_REFUSAL.with(|lr| {
                *lr.borrow_mut() = Some(
                    "the sketch's rules conflict, so no profile can be trusted; resolve the conflict first"
                        .to_string(),
                )
            });
            return None;
        }
    }
    Some(session)
}

/// Discovered loops as profile loops. §8.2: the outline first, then its holes. build normalises a hole to
/// CLOCKWISE (`(a2 < 0.0) == outer`) and discovery hands every loop over counterclockwise, so a hole is reversed
/// HERE rather than inside the builder: reverse_loop would permute the hole's wall faces out from under `roles`,
/// whose whole meaning is "wall face i is profile segment i".
fn profile_loops(loops: &[crate::sketch::wires::WireLoop]) -> Option<Vec<Vec<build::ProfileSeg>>> {
    let mut out: Vec<Vec<build::ProfileSeg>> = Vec::with_capacity(loops.len());
    for lp in loops {
        let mut segs: Vec<build::ProfileSeg> = lp
            .segs
            .iter()
            .map(|s| match s {
                crate::sketch::wires::WireSeg::Line { a, b } => build::ProfileSeg::Line { a: *a, b: *b },
                crate::sketch::wires::WireSeg::Arc { centre, radius, start, sweep } => build::ProfileSeg::Arc {
                    centre: *centre,
                    radius: *radius,
                    start: *start,
                    sweep: *sweep,
                },
            })
            .collect();
        // The session's wire discovery splits edges where they cross, but a touch that
        // joins no ends (two arcs just kissing) is invisible to it: check each loop as
        // the polygon path does.
        if let Some(flaw) = crate::sketch::wires::outline_flaw(&lp.segs) {
            if !matches!(flaw, crate::sketch::wires::OutlineFlaw::NoArea) {
                LAST_PRISM_REFUSAL.with(|lr| *lr.borrow_mut() = Some(format!("this sketch's outline cannot be pulled: {}.", flaw_why(flaw))));
                return None;
            }
        }
        if lp.role == crate::sketch::wires::LoopRole::Hole {
            segs = segs
                .iter()
                .rev()
                .map(|s| match s {
                    build::ProfileSeg::Line { a, b } => build::ProfileSeg::Line { a: *b, b: *a },
                    build::ProfileSeg::Arc { centre, radius, start, sweep } => build::ProfileSeg::Arc {
                        centre: *centre,
                        radius: *radius,
                        start: *start + *sweep,
                        sweep: -*sweep,
                    },
                })
                .collect();
        }
        out.push(segs);
    }
    Some(out)
}

/// Why an outline with this flaw is not a profile, in a student's words.
pub(crate) fn flaw_why(flaw: crate::sketch::wires::OutlineFlaw) -> &'static str {
    use crate::sketch::wires::OutlineFlaw as F;
    match flaw {
        F::Crossing(..) => "two of its edges cross each other, so it does not enclose one area -- move a corner so no edge crosses another",
        F::Touching(..) => "two of its edges touch where they should not (a corner lands on another edge, or two curves just touch), so the outline pinches -- move it so they stay apart",
        F::DoublesBack(..) => "one edge runs back over the edge before it, leaving a spike with no width -- move the corner that makes the spike",
        F::NoArea => "it has no area (its corners lie on one line, or on top of each other), so there is nothing to pull",
    }
}
