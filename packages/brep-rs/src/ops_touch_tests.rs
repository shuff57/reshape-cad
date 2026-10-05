//! Tests of `ops_touch` (W4 pinch contacts).
use super::*;
use crate::build::{box_solid, cylinder_solid, sphere_solid, transform_solid};
use crate::math::Transform;

/// A cylinder along x (radius r, length len) centred at c.
fn cyl_x(c: Vec3, r: f64, len: f64) -> TSolid {
    let s = cylinder_solid([0.0, 0.0, 0.0], r, len, [0.0, 0.0, 1.0]);
    let s = transform_solid(&s, &Transform::rotation([0.0, 1.0, 0.0], std::f64::consts::FRAC_PI_2));
    transform_solid(&s, &Transform::translation(c))
}

fn uses(s: &TSolid) -> (usize, usize, usize) {
    let c = ops::edge_use_counts(&s.faces());
    (c.values().filter(|n| **n == 1).count(), c.values().filter(|n| **n == 2).count(), c.values().filter(|n| **n > 2).count())
}

#[test]
fn a_cylinder_grazing_the_top_from_inside_was_built_as_a_sealed_void_and_now_refuses() {
    let base = box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    // radius 5 centred at z = 5: the top of the wall is at z = 10, the box's top face
    // (turned about its own axis first, so that no sample of the old path lands on the tangent line)
    let tool = {
        let s = cylinder_solid([0.0, 0.0, 0.0], 5.0, 30.0, [0.0, 0.0, 1.0]);
        let s = transform_solid(&s, &Transform::rotation([0.0, 0.0, 1.0], 0.1234));
        let s = transform_solid(&s, &Transform::rotation([0.0, 1.0, 0.0], std::f64::consts::FRAC_PI_2));
        transform_solid(&s, &Transform::translation([0.0, 0.0, 5.0]))
    };
    // the old path: a closed void, every edge used twice (open 0, many 0) ...
    // (the bbox probes sit exactly on the box's top face here, so this particular float input may be
    // declined before the void is built; the script-level test pins the case that was built)
    if let Some(old) = ops::subtract_enclosed(&base, &tool) {
        let (open, two, many) = uses(&old);
        eprintln!("old void: edges used once {open}, twice {two}, more than twice {many}");
        assert!(open == 0 && two > 0 && many == 0);
    }
    // ... but its wall touches the outer skin along a line: that is the pinch, found by the contact test
    let c = contact(&base, &tool).expect("analysed");
    assert!(c.touch && !c.area, "a line contact, no area");
    assert!(ops::boolean("subtract", &base, &tool).is_none());
    assert_eq!(crate::ops_planar::take_reason(), Some(CUT_SENTENCE));
    // a hair lower it is a real void
    let low = cyl_x([0.0, 0.0, 4.99], 5.0, 30.0);
    assert!(!contact(&base, &low).unwrap().touch);
    assert!(ops::boolean("subtract", &base, &low).is_some());
}

#[test]
fn a_through_bore_with_a_ring_of_cavity_left_is_not_a_pinch() {
    // hollow(box 40, wall 2) around a 30 mm bore: the cavity is the box 36 x 36 x 16 less a tube of
    // radius 17, a ring of 1 mm round the tube. `plane_face_contains` misjudges a point in the round
    // hole at exactly 270 degrees as inside the face; a unanimous vote at hair offsets must not.
    let cavity = box_solid([36.0, 36.0, 16.0], [0.0, 0.0, 0.0], None);
    let tube = cylinder_solid([0.0, 0.0, 0.0], 17.0, 20.0, [0.0, 0.0, 1.0]);
    let ring = ops::boolean("subtract", &cavity, &tube).unwrap();
    let outer = box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let bore = cylinder_solid([0.0, 0.0, 0.0], 15.0, 30.0, [0.0, 0.0, 1.0]);
    let part = ops::boolean("subtract", &outer, &bore).unwrap();
    for f in ring.faces() {
        for k in 0..720 {
            let a = k as f64 * std::f64::consts::PI / 360.0;
            for z in [-8.0, 8.0, 3.0] {
                let d = face_dist(&f, [15.0 * a.cos(), 15.0 * a.sin(), z]);
                assert!(d > 1.9, "a point on the 15 mm bore is 2 mm from the ring's faces, read {d} at {} degrees, z {z}", k as f64 * 0.5);
            }
        }
    }
    assert!(!contact(&part, &ring).unwrap().touch);
    assert!(ops::boolean("subtract", &part, &ring).is_some());
}

#[test]
fn a_sphere_touching_a_face_from_inside_at_a_point_refuses() {
    let base = box_solid([40.0, 40.0, 20.0], [0.0, 0.0, 0.0], None);
    let ball = sphere_solid([3.0, -2.0, 0.0], 10.0, [0.0, 0.0, 1.0]);
    assert!(contact(&base, &ball).unwrap().touch);
    assert!(ops::boolean("subtract", &base, &ball).is_none());
    let small = sphere_solid([3.0, -2.0, 0.0], 9.0, [0.0, 0.0, 1.0]);
    assert!(ops::boolean("subtract", &base, &small).is_some());
}

#[test]
fn a_join_that_only_touches_along_a_line_was_two_lumps_and_now_refuses() {
    let a = box_solid([20.0, 20.0, 20.0], [0.0, 0.0, 0.0], None);
    let c = cylinder_solid([20.0, 0.0, 0.0], 10.0, 30.0, [0.0, 0.0, 1.0]);
    let old = ops::boolean_built("union", &a, &c).expect("the legacy path built two lumps");
    let (open, two, many) = uses(&old);
    eprintln!("old join: edges used once {open}, twice {two}, more than twice {many}");
    assert!(ops::boolean("union", &a, &c).is_none());
    assert_eq!(crate::ops_planar::take_reason(), Some(JOIN_SENTENCE));
    // two boxes on one edge, and on one corner
    let e = box_solid([20.0, 20.0, 20.0], [20.0, 20.0, 0.0], None);
    assert!(ops::boolean("union", &a, &e).is_none());
    let k = box_solid([20.0, 20.0, 20.0], [20.0, 20.0, 20.0], None);
    assert!(ops::boolean("union", &a, &k).is_none());
    // a shared face and a real overlap are joins
    let f = box_solid([20.0, 20.0, 20.0], [20.0, 0.0, 0.0], None);
    assert!(ops::boolean("union", &a, &f).is_some());
    let o = cylinder_solid([15.0, 0.0, 0.0], 10.0, 30.0, [0.0, 0.0, 1.0]);
    assert!(ops::boolean("union", &a, &o).is_some());
}

#[test]
fn the_vertex_link_check_sees_two_lumps_on_an_edge_and_passes_a_box() {
    let a = box_solid([20.0, 20.0, 20.0], [0.0, 0.0, 0.0], None);
    assert!(!has_pinch_vertex(&a.faces()));
    let e = box_solid([20.0, 20.0, 20.0], [20.0, 20.0, 0.0], None);
    let mut faces = a.faces();
    faces.extend(e.faces());
    assert!(has_pinch_vertex(&faces), "two boxes on one edge: the vertex link is two cycles");
    let cyl = cylinder_solid([0.0, 0.0, 0.0], 5.0, 10.0, [0.0, 0.0, 1.0]);
    assert!(!has_pinch_vertex(&cyl.faces()));
}
