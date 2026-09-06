import FreeCAD as App
import Part, Sketcher

doc = App.newDocument("PD")
body = doc.addObject("PartDesign::Body", "Body")

# Sketch defaults to the global XY plane (identity placement) when added to a
# Body with no attachment; a closed 40x40 wire is enough for Pad (constraints
# not required for a geometrically-closed profile).
sk = body.newObject("Sketcher::SketchObject", "Sketch")
sk.addGeometry(Part.LineSegment(App.Vector(0,0,0),   App.Vector(40,0,0)),  False)
sk.addGeometry(Part.LineSegment(App.Vector(40,0,0),  App.Vector(40,40,0)), False)
sk.addGeometry(Part.LineSegment(App.Vector(40,40,0), App.Vector(0,40,0)),  False)
sk.addGeometry(Part.LineSegment(App.Vector(0,40,0),  App.Vector(0,0,0)),   False)

pad = body.newObject("PartDesign::Pad", "Pad")
pad.Profile = sk
pad.Length = 20
doc.recompute()

print("PD_PADVOL:", round(pad.Shape.Volume, 4))
print("PD_TIP_IS_PAD:", body.Tip.Name == "Pad")
print("PD_VALID:", pad.Shape.isValid())
