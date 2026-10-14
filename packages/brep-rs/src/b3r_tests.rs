//! SLICE B3R: neighbours of the B3 common cases, probed against FreeCAD 26.3.0 RC1 face counts (volumes are never changed).
#![cfg(test)]
use crate::{build, ops};

type S = build::TSolid;

fn block() -> S {
    build::box_solid([30.0, 20.0, 10.0], [15.0, 10.0, 5.0], None)
}

fn ball(at: [f64; 3], r: f64) -> S {
    build::sphere_solid(at, r, [0.0, 0.0, 1.0])
}

/// (label, tool, FreeCAD faces, exact volume)
fn cases() -> Vec<(String, S, usize, f64)> {
    let mut v = Vec::new();
    let vert = |cx: f64, cy: f64, r: f64| build::cylinder_solid([cx, cy, 5.0], r, 14.0, [0.0, 0.0, 1.0]);
    for (x, vol) in [(1.0, 1770.4624916671185), (3.0, 2161.670741235378), (5.0, 2527.407804285415), (8.0, 2978.0915447965085), (9.0, 3082.8667467121913)] {
        v.push((format!("cyl r10 x{x}"), vert(x, 10.0, 10.0), 4, vol));
    }
    for (y, vol) in [(1.0, 3834.069364682482), (3.0, 4428.255210767734), (5.0, 5006.031562746839)] {
        v.push((format!("cyl r15 y{y}"), vert(15.0, y, 15.0), 4, vol));
    }
    for (x, f, vol) in [(3.0, 4, 1347.1487177940908), (5.0, 3, 1570.7963267948967), (8.0, 3, 1570.7963267948967)] {
        v.push((format!("hcyl r5 x{x}"), build::cylinder_solid([x, 10.0, 5.0], 5.0, 24.0, [0.0, 1.0, 0.0]), f, vol));
    }
    let balls: [([f64; 3], f64, usize, f64); 27] = [
        ([9.0, 13.0, 7.0], 11.0, 6, 2932.0972883970926),
        ([15.0, 10.0, 5.0], 12.0, 7, 3992.1676381072066),
        ([5.0, 10.0, 5.0], 10.0, 5, 2350.862479914361),
        ([5.0, 4.0, 7.0], 13.0, 6, 2529.9944155412104),
        ([16.0, 10.0, 10.0], 14.0, 5, 4473.62793871182),
        ([10.0, 16.0, 5.0], 10.0, 5, 2182.213203823838),
        ([29.0, 17.0, 6.0], 7.0, 5, 583.3041990009939),
        ([28.0, 14.0, 6.0], 9.0, 5, 1309.8243514853007),
        ([7.0, 1.0, 7.0], 9.0, 6, 1183.510496279674),
        ([21.0, 16.0, 10.0], 10.0, 4, 1626.8493867590805),
        ([20.0, 12.0, 5.0], 14.0, 7, 4386.158210705371),
        ([24.0, 13.0, 9.0], 9.0, 4, 1571.9512755906862),
        ([30.0, 2.0, 5.0], 8.0, 5, 584.2508633198477),
        ([3.0, 12.0, 1.0], 8.0, 3, 970.3497790202136),
        ([27.0, 1.0, 5.0], 5.0, 3, 301.19006214929806),
        ([12.0, 3.0, 6.0], 9.0, 5, 1621.5387873706802),
        ([2.0, 4.0, 2.0], 11.0, 6, 1490.0107382277688),
        ([11.0, 1.0, 5.0], 9.0, 5, 1311.3079793132354),
        ([1.0, 6.0, 0.0], 7.0, 4, 428.04723102774267),
        ([16.0, 17.0, 0.0], 9.0, 3, 1130.9733552923137),
        ([26.0, 8.0, 1.0], 5.0, 3, 328.08586685714056),
        ([17.0, 15.0, 1.0], 10.0, 4, 1988.8194975603321),
        ([0.0, 8.0, 0.0], 10.0, 5, 1017.8760197630825),
        ([24.0, 18.0, 7.0], 6.0, 3, 558.0649505140603),
        ([6.0, 0.0, 2.0], 5.0, 3, 205.250720034531),
        ([17.0, 10.0, 3.0], 8.0, 3, 1623.15620435471),
        ([9.0, 0.0, 3.0], 10.0, 5, 1362.5564936315002),
    ];
    for (at, r, f, vol) in balls {
        v.push((format!("ball r{r} at {at:?}"), ball(at, r), f, vol));
    }
    v
}

fn close(a: f64, b: f64, rel: f64) -> bool {
    (a - b).abs() <= rel * b.abs().max(1.0)
}

/// Every cylinder tangent to two faces of the block and crossing a third (or none) is ONE wall face, as FreeCAD 26.3.0 RC1 cuts it:
/// 4 faces vertical, 4 and 3 faces horizontal. This kernel kept a second wall piece where the run of kept cells crossed the wall's seam.
#[test]
fn a_cylinder_tangent_on_two_sides_and_crossing_a_third_is_one_wall_like_freecad() {
    let a = block();
    for (label, t, fc, vol) in cases().into_iter().filter(|c| c.0.contains("cyl")) {
        let r = ops::boolean("intersect", &a, &t).unwrap_or_else(|| panic!("{label}: builds"));
        assert_eq!(r.faces().len(), fc, "{label}: FreeCAD face count");
        let v = build::solid_volume(&r);
        assert!(close(v, vol, 1e-11), "{label}: volume {v} vs {vol}");
        assert!(ops::edge_use_counts(&r.faces()).values().all(|&n| n == 2), "{label}: closed shell");
        let walls = r.faces().iter().filter(|f| matches!(f.borrow().surface, crate::geom::Surface::Cylinder(_))).count();
        assert_eq!(walls, 1, "{label}: one wall face");
        let m = crate::mesh::mesh_solid(&r, 0.05).unwrap_or_else(|| panic!("{label}: meshes"));
        assert!(ops::check_watertight(&m), "{label}: watertight mesh");
        crate::step::write_solid(&r, "b3r").unwrap_or_else(|e| panic!("{label}: STEP {e}"));
    }
}

/// Balls in the block: where the face count is FreeCAD's it is pinned. Four cases build one sphere face fewer than FreeCAD (it cuts a
/// patch that also reaches the opposite half-meridian along the seam, and the far piece is not a hull of planes, which is all a sphere
/// face's trim can say): pinned at the count built, with the exact volume. Nine are refused. No case may change a volume.
#[test]
fn balls_in_a_block_match_freecad_faces_or_say_what_they_do_not() {
    let a = block();
    let refused = ["[5.0, 10.0, 5.0]", "[16.0, 10.0, 10.0]", "[10.0, 16.0, 5.0]", "[21.0, 16.0, 10.0]", "[24.0, 13.0, 9.0]", "[3.0, 12.0, 1.0]", "[27.0, 1.0, 5.0]", "[0.0, 8.0, 0.0]", "[24.0, 18.0, 7.0]"];
    let one_fewer = ["[9.0, 13.0, 7.0]", "[7.0, 1.0, 7.0]", "[12.0, 3.0, 6.0]", "[11.0, 1.0, 5.0]"];
    let (mut matched, mut fewer, mut refusals) = (0, 0, 0);
    for (label, t, fc, vol) in cases().into_iter().filter(|c| c.0.starts_with("ball")) {
        match ops::boolean("intersect", &a, &t) {
            Some(r) => {
                let v = build::solid_volume(&r);
                assert!(close(v, vol, 1e-11), "{label}: volume {v} vs {vol}");
                assert!(ops::edge_use_counts(&r.faces()).values().all(|&n| n == 2), "{label}: closed shell");
                let n = r.faces().len();
                if one_fewer.iter().any(|k| label.ends_with(k)) {
                    assert_eq!(n + 1, fc, "{label}: known deviation, one sphere face fewer than FreeCAD");
                    fewer += 1;
                } else {
                    assert_eq!(n, fc, "{label}: FreeCAD face count");
                    matched += 1;
                }
            }
            None => {
                assert!(refused.iter().any(|k| label.ends_with(k)), "{label}: refused unexpectedly");
                refusals += 1;
            }
        }
    }
    assert_eq!((matched, fewer, refusals), (14, 4, 9));
}

/// A ball the kernel cannot prove is refused per feature, in one sentence, with the target shown without it.
#[test]
fn a_ball_clipped_by_two_planes_off_centre_is_refused_in_a_sentence() {
    let doc = r#"{"version":1,"features":[{"id":"A","kind":"box","size":[30,20,10],"center":[15,10,5]},{"id":"B","kind":"sphere","radius":10,"center":[5,10,5]},{"id":"K","kind":"combine","op":"intersect","targets":["A","B"]}]}"#;
    let m: serde_json::Value = serde_json::from_str(&crate::wasm::measure_doc(doc)).unwrap();
    let text = m["refusals"]["K"].as_str().expect("refused");
    assert_eq!(
        text,
        "combine K: brep-rs cannot boolean these two solids (an unsupported surface pair, or a surface/orientation combination its face-by-face boolean does not intersect yet) -- K is shown without it."
    );
}

