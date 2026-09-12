import sys
import FreeCAD as App
import Part

print("TECHDRAW_IMPORT:start")
import TechDraw
print("TECHDRAW_IMPORT:ok")

doc = App.newDocument("TechDrawSmoke")

box = doc.addObject("Part::Box", "Box")
box.Length = 40
box.Width = 40
box.Height = 20
doc.recompute()

if box.Shape.isNull():
    print("TECHDRAW_RESULT:FAIL:box shape null")
    sys.exit(0)

print("TECHDRAW_PAGE:creating")
page = doc.addObject("TechDraw::DrawPage", "Page")
template = doc.addObject("TechDraw::DrawSVGTemplate", "Template")
template.Template = "/freecad_home/Mod/TechDraw/Templates/ASME/USLetter_Landscape_blank.svg"
page.Template = template

view = doc.addObject("TechDraw::DrawViewPart", "View")
view.Source = [box]
page.addView(view)

try:
    doc.recompute()
except Exception as e:
    print(f"TECHDRAW_RECOMPUTE_EXCEPTION:{e!r}")

print(f"TECHDRAW_PAGE_VIEWCOUNT:{len(page.Views)}")
print(f"TECHDRAW_VIEW_STATE:{view.State}")

has_shape = hasattr(view, "Shape") and view.Shape is not None and not view.Shape.isNull()
print(f"TECHDRAW_VIEW_HAS_SHAPE:{has_shape}")
if has_shape:
    print(f"TECHDRAW_VIEW_BBOX:{view.Shape.BoundBox}")

print(f"TECHDRAW_VIEW_MEMBERS:{[a for a in dir(view) if not a.startswith('_')]}")

try:
    svg_out = "/tmp/g4out/techdraw-smoke.svg"
    page.exportToSvg(svg_out) if hasattr(page, "exportToSvg") else None
    import os
    if os.path.exists(svg_out):
        print(f"TECHDRAW_SVG_EXPORTED:{os.path.getsize(svg_out)} bytes")
    else:
        print("TECHDRAW_SVG_EXPORT:no exportToSvg method or file not written")
except Exception as e:
    print(f"TECHDRAW_SVG_EXPORT_EXCEPTION:{e!r}")

print("TECHDRAW_RESULT:PASS")
