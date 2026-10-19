# Re-splices rows-r5.part.mjs into build-rows.mjs (the part file is the source of the round-5 rows; build-rows.mjs holds a copy so that it runs on its own).
import os
d = os.path.dirname(os.path.abspath(__file__))
t = open(os.path.join(d, 'build-rows.mjs')).read()
part = open(os.path.join(d, 'rows-r5.part.mjs')).read()
a = t.index("// ======================================================================================================================\n// ROUND 5 ADDITIONS")
b = t.index("writeFileSync(`${OUT}/sketch-geometry.json`")
open(os.path.join(d, 'build-rows.mjs'), 'w').write(t[:a] + part + "\n" + t[b:])
print('spliced')
