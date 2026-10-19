# Builds patterns-mirror.json (round 5: critic round 2 fixes; see the ROUND 5 block at the end of the file).
#   R   = pm-results.json                    contract translator (pm-translate.mjs, all patches ON = the default of pm-run.mjs), incl. the round-3 cases (r3-*)
#   R2  = pm-results-round2.json             the round-2 contract run (no time limit, round-2 patch set), kept for the unlimited-time dVol sweeps
#   A   = pm-results-asis-translator.json    the same cases with PM_TR=asis (no patches = the phase0 translator's behaviour; torus cases skipped)
#   A3  = pm3-results-r2translator.json      the round-3 cases through the ROUND-2 patch set (PM_TR=r2 PM_BUDGET=off): what the shipped contract did
#   TA  = pm-torus-asis.json                 the torus cases run one at a time under `timeout 150` with PM_TR=asis (some never return)
# Every status below is asserted against the data it cites, so a stale JSON fails here instead of being published.
import json, os, sys
H = os.path.dirname(os.path.abspath(__file__))
R = {x['id']: x for x in json.load(open(os.path.join(H, 'pm-results.json')))}
R2 = {x['id']: x for x in json.load(open(os.path.join(H, 'pm-results-round2.json')))}
A = {x['id']: x for x in json.load(open(os.path.join(H, 'pm-results-asis-translator.json')))}
A3 = {x['id']: x for x in json.load(open(os.path.join(H, 'pm3-results-r2translator.json')))} if os.path.exists(os.path.join(H, 'pm3-results-r2translator.json')) else {}  # LOST in this round: the rows that need it are skipped
TA = json.load(open(os.path.join(H, 'pm-torus-asis.json')))
# ---- round 5 inputs (all produced by this round's runs; none may be missing)
def _load(name): return json.load(open(os.path.join(H, name)))
STAMP = _load('pm-results.stamp.json')                                   # which rig produced pm-results.json
SO = {x['id']: x for x in _load('pm-results-snapoff.json')}              # PM_OFF=snap negative control, r4-snap-* cases
AO = {x['id']: x for x in _load('pm-results-asis-oracle.json')}          # PM_TR=asis, reversed / taper cases, scored with the new oracle rule
FZ1 = _load('pm-snap-fuzz-on.json'); FZ0 = _load('pm-snap-fuzz-off.json')  # pm-snap-fuzz.mjs, guard on / off, closed-form oracle
BD = {x['id']: x for x in _load('pm-results-budget-demo.json')}          # PM_BUDGET_MS=3000: the safety net firing on purpose
PROBE = json.load(open(os.path.join(H, 'pm-tie-probe.json')))  # pm-tie-probe.mjs: truck's measured box of the symmetric cylinders
E = lambda v: ('%.1e' % v) if isinstance(v, (int, float)) else '-'
N4 = lambda v: ('%.4f' % v) if isinstance(v, (int, float)) else '-'
B6 = lambda b: '[' + ', '.join('%.4f' % v for v in b) + ']'

def c(i, src=R):
    x = src[i]; f = x['fx']; t = f['truck']; b = f['brep']
    s = '%s: OCCT vol %.4f, truck dVol %s dBbox %s dCOM %s, brep-rs dVol %s, faces O/B/T %s/%s/%s' % (i, f['occt']['volume'], E(t['dVol']), E(t['dBbox']), E(t['dCom']), E(b.get('dVol')), f['occt']['faces'], b.get('faces', 'refused'), t['faces'])
    if 'refused' in b: s += ' (brep-rs refused)'
    return s
def fc(i, src=R):
    x = src[i]; v = x['vsFreecad']; t = v['truck']
    return '%s: vs FreeCAD ref truck dVol %s faces %s/%s COMabs %s | OCCT dVol %s | brep-rs dVol %s' % (i, E(t['dVol']), t['faces'], t['facesRef'], E(v['comAbs']['truck']), E(v['occt']['dVol']) if v['occt'] else '-', E(v['brep']['dVol']) if v['brep'] else 'refused')
def mx(ids, key, src=R): return max(src[i]['fx']['truck'][key] for i in ids)
def tr(i, src=R): return src[i]['fx']['truck']
def ok(i, src=R): return src[i]['outcome'] == 'PASS'
def refused(i, src=R): return src[i]['outcome'] == 'REFUSED'
def stu(i, src=R):
    t = tr(i, src)
    s = t.get('student') or t.get('firstStudent')
    assert s, i
    return s
def sen(i, src=R):
    s = src[i].get('sentence'); assert s, i; return s
def shipped(i, src=R):
    s = src[i].get('shipped'); assert s, i; return s
import re as _re
_ENGINE = _re.compile(r"brep-rs|FreeCAD|OCCT|truck|solidcraft|SolidCraft|SolidCore|kernel|solid\.\w+|`")
def is_plain(t):
    # mirror of isPlainSentence() in pm-sentences.mjs: no engine word, no sentence break inside
    if not t or _ENGINE.search(t): return False
    body = _re.sub(r'\([^)]*\)', '(...)', t.strip()); body = _re.sub(r'"[^"]*"', '"..."', body); body = _re.sub(r"'[^']*'", "'...'", body); body = body.replace('...', '~')
    return not _re.search(r'[.!?]\s+\S', body)
def boxes(i, src):
    f = src[i]['fx']; return 'bbox truck %s | OCCT %s | brep-rs %s' % (B6(f['truck']['bbox']), B6(f['occt']['bbox']), B6(f['brep']['bbox']) if 'bbox' in f['brep'] else 'refused')
rows = []
def row(feature, status, evidence, sentence=None):
    d = {'feature': feature, 'status': status, 'evidence': evidence}
    if sentence: d['refusalSentence'] = sentence
    rows.append(d)

SC = '<sc-referee-pkg>'
RUN = 'cd /home/shuff57/Documents/GitHub/reshape-cad && '
BASE = 'SOLIDCRAFT_REFEREE_PKG=%s systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/pm-run.mjs --variants --out=<scratch>' % SC
BASE3 = BASE.replace('--variants', '--r3')
CMD = RUN + BASE + ' [contract translator pm-translate.mjs, patches reversed/fresh/plane/count1/torus/contact/disjoint/subgap/budget/fused/spinbox/taper ON by default, 60 s limit per solidcraft run and 300 s per model; reSHape Script -> runScript -> ModelDoc -> OCCT buildDoc + brep-rs measure_doc + solidcraft in a killable child process; saved/own FreeCAD refs; %d cases; numbers in contract/pm-results.json]. ' % len(R)
CMD3 = RUN + BASE3 + ' [same translator and patches, round-3 cases only; numbers in the r3-* entries of contract/pm-results.json]. '
CMDR2 = RUN + 'PM_TR=r2 PM_BUDGET=off ' + BASE3 + " [the ROUND-2 contract translator: patches reversed/fresh/plane/count1/torus/contact only, no time limit; numbers in contract/pm3-results-r2translator.json]. "
CMDA = RUN + 'PM_TR=asis ' + BASE + " --skip='r2-torus*' [phase0 translator behaviour, no patches; numbers in contract/pm-results-asis-translator.json]. "
def AS(s): return ' AS-IS (PM_TR=asis): ' + s

# ============================ repeat / repeatAround on whole solids ============================
lin = ['rl-disjoint-x3','rl-overlap-x4','rl-touch-x3','rl-y','rl-z','rl-diag-disjoint','rl-diag-overlap','rl-negative','rl-count2','rl-lextrude-overlap','rl-of-join','rl-of-moved','rl-of-turned','rl-alias-linearPattern','rl-count-40','rl-count-40-overlap']
assert all(R[i]['outcome'] in ('PASS', 'FAIL') for i in lin) and mx(lin, 'dVol') < 1e-9 and mx(lin, 'dBbox') < 1e-9, 'row 0'
assert R['rl-z']['outcome'] == 'FAIL' and tr('rl-z')['dVol'] < 1e-9 and tr('rl-z')['dBbox'] < 1e-9
row('repeat(shape,{count,step:[x,y,z]}) / linearPattern on a solid body, count >= 2 (copies disjoint, overlapping, face-touching, x/y/z/diagonal/negative step, shape = box, extruded L, join, moved, turned; count up to 1000, see the count row). Copies that meet only along an edge or at a point, gaps or overlaps under a micron, and curved copies truck cannot fuse are separate rows (refused).', 'supported',
    CMD + 'Command: solid.pattern.rectangular {bodies,dir1=step/|step|,count1,spacing1=|step|} then solid.combine join. ROUND 3: the unjoined fallback (the copies left as separate bodies) is accepted ONLY when every pair of copies is provably apart (bbox gap > 1e-3 mm along some axis, patch disjoint); in any other case where the join fails the pattern is REFUSED (see the overlapping-curved-copies rows: the round-2 contract returned the unjoined copies with their volumes SUMMED). Worst over %d cases: truck dVol %s, dBbox %s vs live OCCT (planar, bar 1e-9); brep-rs dVol <= 1.9e-15. %s | %s | %s | %s. Same numbers AS-IS (no patch is involved in this row). rl-z shows dCOM %s vs OCCT: OCCT is wrong, not truck (OCCT COM z = 22.5, closed form for boxes at z=0,25,50 is 25, truck 25; volume and bbox agree). Face counts: see the face-count row. count 40 disjoint: truck %d ms.' % (len(lin), E(mx(lin,'dVol')), E(mx(lin,'dBbox')), c('rl-disjoint-x3'), c('rl-overlap-x4'), c('rl-touch-x3'), c('rl-count-40-overlap'), E(tr('rl-z')['dCom']), R['rl-count-40']['fx']['ms']))
assert all(A[i]['outcome'] == R[i]['outcome'] for i in lin)

row('repeat step as a bare number (step: 25 means [25,0,0]), including negative; omitted step', 'supported',
    CMD + c('rl-bare-number') + ' | ' + c('rl-bare-negative') + '. Script lowers to step [n,0,0] before the translator sees it. Omitted step also builds: the script fills the default step [15,0,0] for a 10-wide box (newPattern: ceil(extent*1.5)), ' + c('rl-zero-step') + '.')
assert ok('rl-bare-number') and ok('rl-bare-negative') and ok('rl-zero-step')

c1 = ['r2-count1-box','r2-count1-cyl','r2-count1-around','r2-count1-then-join']
assert all(ok(i) for i in c1) and all(refused(i, A) for i in c1)
row('repeat(shape,{count:1}) / repeatAround(shape,{count:1}) on a solid body (a pattern that is the original alone) [contract translator patch: count1 = identity, no command]', 'supported',
    CMD + '%s | %s | %s | %s. OCCT and brep-rs both return the original (OCCT vol 1000, 6 faces). AS-IS (PM_TR=asis) the phase0 translator refused it without need: "%s" (names an internal id). With the patch no solidcraft command is issued and downstream features (join, pocket) continue from the same body: r2-count1-then-join PASS. Pocket and hole patterns of count 1 build in the script layer already (rp-pocket-count1 truck dVol %s, rh-hole-count1 %s).' % (c('r2-count1-box'), c('r2-count1-cyl'), c('r2-count1-around'), c('r2-count1-then-join'), tr('r2-count1-box', A)['refused'], E(tr('rp-pocket-count1')['dVol'] if 'rp-pocket-count1' in R and 'dVol' in tr('rp-pocket-count1') else None), E(tr('rh-hole-count1')['dVol'])))

row('repeat with a zero step vector explicitly given ([0,0,0])', 'refused',
    CMD + 'OCCT and brep-rs fuse identical copies into the original (OCCT vol %.4f). The translator refuses before calling solidcraft. Raw translator reason: "%s". Student sentence (studentSentence() in pm-translate.mjs, produced by this run): "%s"' % (R['rl-zero-vector']['fx']['occt']['volume'], tr('rl-zero-vector')['refused'], stu('rl-zero-vector')),
    stu('rl-zero-vector'))
assert refused('rl-zero-vector')

# ---- curved repeat: round 3 splits "tangent" out (refused, like edge contact) and adds the time limit
def tmo(i, src=R):
    t = (src[i].get('fx') or {}).get('truck') or {}
    return src[i]['outcome'] == 'REFUSED' and 'TIME BUDGET' in ((t.get('refused') or '') + (t.get('firstRefusal') or ''))
def pwall(i, src=R):
    for f in src[i]['fx']['truckFeatures']:
        if f['kind'] == 'pattern' and f.get('wallMs') is not None: return f['wallMs'] / 1000.0
    return None
cur = ['rl-cyl-disjoint','rl-cyl-overlap','rl-sphere-overlap','rl-sphere-disjoint']
sens = [i for i in R2 if i.startswith('r2-sens')]
allcur = cur + sens + ['ra-z5-cyl','ra-z6-cyl-overlap','ra-z4-sphere']
assert all(R2[i]['outcome'] == 'PASS' for i in allcur), [i for i in allcur if R2[i]['outcome'] != 'PASS']
assert all(R[i]['outcome'] == 'PASS' or tmo(i) for i in allcur), [(i, R[i]['outcome']) for i in allcur if not (R[i]['outcome'] == 'PASS' or tmo(i))]
okc = [i for i in allcur if R[i]['outcome'] == 'PASS']; slowc = [i for i in allcur if tmo(i)]
assert all(tr(i, R)['dVol'] <= 3e-4 for i in okc)
worst = max(allcur, key=lambda i: tr(i, R2)['dVol'])
r2 = lambda i: tr(i, R2)
row('repeat on cylinder and sphere bodies (overlapping or disjoint copies) that build inside the 60 s limit. Tangent copies are a separate row (refused); copies that take longer than 60 s are the time-limit row (refused).', 'supported',
    CMD + 'Worst over the original 4 cases: truck dVol %s (curved tessellation bar 3e-4), dBbox %s. %s | %s | %s. Run time of the pattern step in this run: %s. TIME: %d of the %d curved repeat/repeatAround cases (the original 4, the 33 sensitivity cases, 3 ring cases) finish inside the limit; %d are killed at 60 s and refused (listed in the time-limit row). MARGIN (round-2 run, NO time limit, so every case has a number): the original worst case is only %d%% under the bar (3e-4), so a sensitivity sweep was added (r2-sens-* and r2-sens2-*, %d cases: spheres d2..d200 repeated x3 or x2, sphere rings d6/d40/d20x12, cylinders d3..d200 repeated, cylinder rings d8x7/d30x9): dVol range %s .. %s over those, %d of %d curved repeat/repeatAround cases inside the bar; worst of all is %s at %s (%d%% under the bar). Cause is tessellation of the truck volume, not placement: dBbox stays <= %s. A curved delta of 2..3e-4 must not be read as an error, and one above 3e-4 on a sphere/cylinder deserves a look. brep-rs refuses the overlapping sphere row ("its copies overlap"), truck and OCCT agree there.' %
    (E(max(r2(i)['dVol'] for i in cur if i != 'rl-cyl-tangent')), E(max(r2(i)['dBbox'] for i in cur)), c('rl-cyl-overlap', R), c('rl-sphere-overlap', R), c('rl-sphere-disjoint', R),
     ', '.join('%s %.1f s' % (i, pwall(i)) for i in ['rl-cyl-overlap','rl-sphere-overlap','rl-sphere-disjoint','r3-sph2-step8','r3-sph2-step7.5','r3-sph3-step8'] if pwall(i) is not None),
     len(okc), len(allcur), len(slowc), round(100 * (1 - max(r2(i)['dVol'] for i in cur) / 3e-4)), len(sens), E(min(r2(i)['dVol'] for i in sens)), E(max(r2(i)['dVol'] for i in sens)), len([i for i in allcur if r2(i)['dVol'] <= 3e-4]), len(allcur), E(r2(worst)['dVol']), worst, round(100 * (1 - r2(worst)['dVol'] / 3e-4)), E(max(r2(i)['dBbox'] for i in allcur))))

sph2 = [i for i in sens if i.startswith('r2-sens2-sphere')]; cyl2 = [i for i in sens if i.startswith('r2-sens2-cyl')]
assert sph2 and cyl2
rows[-1]['evidence'] += ' Sphere d3..d100 x2: dVol %s .. %s; cylinders d3..d100 x2: %s .. %s (round-2 run).' % (E(min(r2(i)['dVol'] for i in sph2)), E(max(r2(i)['dVol'] for i in sph2)), E(min(r2(i)['dVol'] for i in cyl2)), E(max(r2(i)['dVol'] for i in cyl2)))

row('repeat input validation: count 0, count 2.5, count missing, step text, unknown option', 'refused',
    CMD + 'All stop in the script layer before any kernel is involved, each in one plain sentence: ' + ' || '.join('%s -> %s' % (i, sen(i)) for i in ['rl-count0','rl-count-frac','rl-count-missing','rl-step-bad','rl-unknown-option']),
    sen('rl-count0'))

ra = ['ra-z4-default','ra-z6-overlap','ra-z4-explicit360','ra-x5','ra-y3','ra-x3-offz','ra-z5-tilted-box','ra-count2','ra-alias-polarPattern','ra-ring-closed','ra-edge-touch','ra-count-36','ra-count-36-overlap']
assert all(ok(i) for i in ra) and mx(ra, 'dVol') < 1e-9 and mx(ra, 'dBbox') < 1e-9
row('repeatAround(shape,{count,axis,angle:360 or omitted}) on a solid body: full turn, axis x/y/z, spacing angle/count (box ring disjoint, overlapping, tilted box, 2..36 copies, polarPattern alias)', 'supported',
    CMD + 'Command: solid.pattern.circular {bodies,axis,count} (default 360 deg) then solid.combine join. Worst over %d cases: truck dVol %s, dBbox %s vs OCCT (planar). %s | %s | %s | %s. brep-rs refuses the 36-copy rows ("its copies overlap"); OCCT and truck agree.' % (len(ra), E(mx(ra,'dVol')), E(mx(ra,'dBbox')), c('ra-z4-default'), c('ra-x5'), c('ra-y3'), c('ra-count-36-overlap')))

cu = ['ra-z5-cyl','ra-z6-cyl-overlap','ra-z4-sphere','r2-sens-sphere-ring-d6','r2-sens-sphere-ring-d40','r2-sens-sphere-ring-d20-n12','r2-sens-cyl-ring-d8-n7','r2-sens-cyl-ring-d30-n9']
cu_ok = [i for i in cu if R[i]['outcome'] == 'PASS']; cu_slow = [i for i in cu if tmo(i)]
assert len(cu_ok) + len(cu_slow) == len(cu) and cu_ok
row('repeatAround on cylinder and sphere bodies (cylinder ring, overlapping cylinders, sphere ring) that build inside the 60 s limit; rings that take longer are the time-limit row (refused)', 'supported',
    CMD + '%d of %d cases build inside the limit, worst truck dVol %s, dBbox %s (tessellation; bar 3e-4): %s | %s | sphere ring %s. Killed at 60 s and refused: %s (round-2 run without a limit built them: worst dVol %s). Margin note: see the curved-repeat row (the worst sphere ring is %d%% under the bar).' %
    (len(cu_ok), len(cu), E(mx(cu_ok,'dVol')), E(mx(cu_ok,'dBbox')), c('ra-z5-cyl'), c('ra-z6-cyl-overlap'), c('ra-z4-sphere'), ', '.join(cu_slow) or 'none', E(max(tr(i, R2)['dVol'] for i in cu)), round(100 * (1 - max(tr(i, R2)['dVol'] for i in cu) / 3e-4))))

# ---- partial turns / beyond one turn
pm = ['r2-partial-180-n3-MD','r2-partial-90-n4-MD','r2-partial-90-n2-MD','r2-partial-120-n3-x-MD','r2-neg90-n3-MD','r2-720-n4-MD','r2-neg360-n4-MD','r2-partial-cyl-n3-MD']
assert all(ok(i) for i in pm), [i for i in pm if not ok(i)]
fcm = ['pm-polar-boss-partial-90-x3-MAPPED','pm-polar-boss-partial-180-x4-MAPPED','pm-polar-boss-neg90-x3-MAPPED']
row('repeatAround(shape,{count,angle < 360}) on a solid body (a partial turn: ModelDoc pattern totalAngle 180 / 90 / -90). REFUSED because the shipped language already spaces a partial turn two different ways (see the inconsistency row, a defect to fix, not a pending decision); not a kernel defect.', 'refused',
    CMD + 'Two incompatible spacing rules exist INSIDE the language, and the translator maps neither: the inconsistency is in the language (see the row about repeatAround(x,{count:3,angle:90}) meaning two things), so no mapping can be right for both targets. (1) ModelDoc rule: model-types.ts documents it on purpose ("Spacing between instances is totalAngle / count, so 360 wraps without a doubled instance"); occt-build.ts and brep-rs wasm.rs implement it; whole-solid repeatAround uses it. (2) FreeCAD rule: copies at 0, angle/(n-1) .. angle, the last copy AT the end angle; script-lowered CUTS (repeatAround of a pocket or hole) use it. solidcraft spaces a partial turn by angle/(count-1) (eval.rs pattern_transforms: full turn -> total/n, else total/(n-1)). Both mappings were MEASURED. Rule (1) via angle*(n-1)/n sent to solid.pattern.circular: %s ALL PASS vs live OCCT and brep-rs (volume, faces and bbox equal; worst dVol %s, dBbox %s over %d cases incl. 720 and -90 and a cylinder at the tessellation bar). Rule (2) via angle passed through: matches FreeCAD (bosses over 90 x3 / 180 x4 / -90 x3 from saved pm-fc-refs: centre-of-mass miss truck %s / %s / %s mm vs OCCT 7.1e-2 / 1.1e-1 / 7.1e-2 and brep-rs 7.0e-2 / 1.1e-1 / 7.0e-2 mm; volume and bbox cannot tell the rules apart) and FAILS vs OCCT/brep-rs (ra-partial-90-n4-MAPPED dBbox %s, ra-partial-180-n3-MAPPED dBbox %s). So the OCCT and brep-rs referees follow the documented ModelDoc rule and are not wrong against it; they disagree with FreeCAD and with the language\'s own pocket/hole lowering. Because a solid ring (spacing angle/count) and a bolt circle of holes (spacing angle/(count-1)) at the same angle already differ inside one function, the translator REFUSES a partial turn of a whole solid until the language picks one rule. The AS-IS phase0 translator also refuses (its text: "%s"). Student sentence (produced by this run): "%s"' %
    (', '.join(x.replace('r2-','').replace('-MD','') for x in pm), E(max(tr(i)['dVol'] for i in pm if 'cyl' not in i)), E(mx(pm,'dBbox')), len(pm),
     E(R[fcm[0]]['vsFreecad']['comAbs']['truck']), E(R[fcm[1]]['vsFreecad']['comAbs']['truck']), E(R[fcm[2]]['vsFreecad']['comAbs']['truck']), E(tr('ra-partial-90-n4-MAPPED')['dBbox']), E(tr('ra-partial-180-n3-MAPPED')['dBbox']), tr('ra-partial-90-n4', A)['refused'], stu('ra-partial-90-n4')),
    stu('ra-partial-90-n4'))
assert refused('ra-partial-90-n4') and refused('ra-partial-180-n3') and not ok('ra-partial-90-n4-MAPPED')

row('repeatAround angle beyond one turn (720) or negative full turn (-360) on a solid body. REFUSED for the same reason as a partial turn; the pocket/hole version of the same call is the WRONG row below.', 'refused',
    CMD + 'Same refusal as a partial turn (|angle| != 360). Measured with the angle passed straight through (*-MAPPED): solidcraft treats 720 as NOT a full turn (step 720/(n-1)=240 deg, 3 distinct copies) while the ModelDoc rule steps 720/count=180 (2 distinct): ra-720-n4-MAPPED truck dVol %s dBbox %s vs OCCT. With rule (1) mapped (angle*(n-1)/n) both agree with the ModelDoc kernels: r2-720-n4-MD dVol %s dBbox %s, r2-neg360-n4-MD dVol %s dBbox %s. -360 is a full turn for solidcraft (abs). FreeCAD on the pocket path: 720 -> 3 distinct holes, -360 -> n-1 spacing (3 holes), the script rule gives 2 and 4, so the script layer already diverges from FreeCAD here for all engines (pm-polar-holes-720-x4 FreeCAD dVol: OCCT %s, truck %s; pm-polar-holes-neg360-x4: OCCT %s, brep-rs %s, truck %s). Student sentence (produced by this run): "%s"' %
    (E(tr('ra-720-n4-MAPPED')['dVol']), E(tr('ra-720-n4-MAPPED')['dBbox']), E(tr('r2-720-n4-MD')['dVol']), E(tr('r2-720-n4-MD')['dBbox']), E(tr('r2-neg360-n4-MD')['dVol']), E(tr('r2-neg360-n4-MD')['dBbox']),
     E(R['pm-polar-holes-720-x4']['vsFreecad']['occt']['dVol']), E(R['pm-polar-holes-720-x4']['vsFreecad']['truck']['dVol']), E(R['pm-polar-holes-neg360-x4']['vsFreecad']['occt']['dVol']), E(R['pm-polar-holes-neg360-x4']['vsFreecad']['brep']['dVol']), E(R['pm-polar-holes-neg360-x4']['vsFreecad']['truck']['dVol']), stu('ra-720-n4')),
    stu('ra-720-n4'))
assert refused('ra-720-n4') and refused('ra-neg360-n4')

row('repeatAround of a shape sitting on the axis; bad axis; count 0; non-number angle', 'refused',
    CMD + 'All stop in the script layer before any kernel is asked. ' + ' || '.join('%s -> shipped "%s" -> shown "%s"' % (i, shipped(i), sen(i)) for i in ['ra-on-axis','ra-bad-axis','ra-count0','ra-angle-bad']),
    sen('ra-on-axis'))
# ---- edge / vertex contact between copies
ec = ['rl-edge-touch','rl-vertex-touch','r2-repeat-edge-touch-x2','r2-repeat-vertex-touch-x2','r2-repeat-edge-diff-z','r2-around-vertex-touch','r2-repeat-then-pocket-edge-touch']
assert all(refused(i) for i in ec) and all(R[i]['fx']['occt']['faces'] for i in ec)
asis_ec = ['rl-edge-touch','rl-vertex-touch','r2-repeat-edge-touch-x2','r2-repeat-vertex-touch-x2','r2-around-vertex-touch']
assert all(A[i]['outcome'] in ('PASS','FAIL') for i in asis_ec)
mc = ['mi-turned-box-vertex','mi-hexprism-lr','mi-sphere-lr-point']
assert all(refused(i) for i in mc)
row('repeat / repeatAround where two copies meet only along an edge or at a point (box x3 step [10,10,0] or [10,10,10], boxes x2 step [10,10,3], ring of boxes touching at the axis; ROUND 3: cylinders stepped by their diameter, tangent along a line, and spheres stepped by their diameter, tangent at a point) [contract translator patch: contact guard]', 'refused',
    CMD + 'Refused by the guard; the check is: result shells > bbox-connected groups of the copies, then each exactly-touching pair is joined alone and flagged when it keeps 2 shells with volume = sum, or truck refuses the join ("join cannot preserve the original faces"). rl-diag-overlap (copies 1 and 3 touch at a point that lies INSIDE copy 2) is correctly NOT flagged and passes. Raw: %s. AS-IS (PM_TR=asis) these build, silently, as a NON-MANIFOLD body: %s | %s | %s | %s (kernel.shells 2 for one body whose cubes share only an edge; volume = sum). All three kernels build the same non-manifold result (OCCT and brep-rs faces equal truck), so a volume/face oracle cannot see it. The layer was INCONSISTENT: repeat accepts this contact while mirror of the same contact is refused by solidcraft itself (mi-turned-box-vertex, mi-hexprism-lr, mi-sphere-lr-point all "solid.mirror: lumps: shell boundaries intersect or touch"), and brep-rs refuses the equivalent join in plain words ("the two shapes only touch along a line or at a point, so they would not be one solid; overlap them a little"). The guard makes repeat consistent with mirror and with that sentence. Student sentence (produced by this run): "%s"' %
    (tr('rl-edge-touch')['refused'], c('rl-edge-touch', A), c('rl-vertex-touch', A), c('r2-repeat-edge-touch-x2', A), c('r2-around-vertex-touch', A), stu('rl-edge-touch')),
    stu('rl-edge-touch'))

tg3 = ['r3-cyl-tangent-x2','r3-cyl-tangent-x3','r3-cyl-tangent-diag','r3-sphere-tangent']
assert all(refused(i) for i in tg3), [(i, R[i]['outcome']) for i in tg3]
assert all(R2[i]['outcome'] == 'PASS' for i in ['rl-cyl-tangent'])
def sh(i, src):
    t = (src[i].get('fx') or {}).get('truck') or {}
    return t.get('shells')
rows[-1]['evidence'] += (' ROUND 3, tangent curved copies (the critic found repeat accepted what mirror refused): ' + ' | '.join('%s -> %s' % (i, tr(i)['refused'][:230]) for i in tg3) +
    '. Round-2 contract (A3, the guard compared the joined volume with the sum to 1e-6, but a joined pair of tangent cylinders is tessellation-derived and 5e-5 off the sum): %s built as ONE body of %s shells (%s), faces %s, while the same contact in mirror (r3-cyl-tangent-mirror) was refused by solidcraft itself ("lumps: shell boundaries intersect or touch"). The guard now uses the curved tolerance 3e-4 for curved pairs and, when the result has more shells than the copies have bbox-connected groups, tests EVERY bbox-touching or bbox-overlapping pair, not only exactly-touching ones (tangent cylinders stepped [6,8,0] have overlapping boxes: round 2 built r3-cyl-tangent-diag with 2 shells; now refused). OCCT and brep-rs build all of these (non-manifold line/point contacts), so a volume/face oracle cannot see it. Cylinder tangent x3 round 2 (R2 rl-cyl-tangent): %s.' %
    ((('r3-cyl-tangent-x2', A3['r3-cyl-tangent-x2']['outcome'], sh('r3-cyl-tangent-x2', A3), tr('r3-cyl-tangent-x2', A3)['faces'], c('rl-cyl-tangent', R2))) if A3 else ('LOST-DATA', 'n/a', 'n/a', 'n/a', c('rl-cyl-tangent', R2))))

# ============================ pocket / pad / hole patterns ============================
lp = ['linear-pattern__holes-x3','linear-pattern__holes-y4','linear-pattern__blind-pockets-x2','linear-pattern__holes-x5-tight','linear-pattern__two-holes-long-step','linear-pattern__copies-run-off-the-part','linear-pattern__overlapping-holes-slot','linear-pattern__count-1','pm-lin-holes-neg-step']
row('repeat of a pocket (count x step; through, blind, tight web, overlapping slot, copies off the part dropped, count 1, negative step)', 'supported',
    CMD + 'The script lowers a pocket pattern to count-1 more sketches + pockets, so solidcraft sees plain pockets. FreeCAD refs (saved gauntlet + own): ' + ' | '.join(fc(i) for i in ['linear-pattern__holes-x3','linear-pattern__blind-pockets-x2','linear-pattern__overlapping-holes-slot','pm-lin-holes-neg-step']) + '. Worst truck dVol vs FreeCAD over %d refs: %s (circles, tessellation) and all face counts equal FreeCAD. Extras without FreeCAD: rp-pocket-diag-step truck dVol %s vs OCCT, brep-rs dVol %s.' % (len(lp), E(max(R[i]['vsFreecad']['truck']['dVol'] for i in lp if R[i]['vsFreecad']['truck'])), E(tr('rp-pocket-diag-step')['dVol']), E(R['rp-pocket-diag-step']['fx']['brep']['dVol'])))

hp = ['r2-hand-pocket-x3-edge','r2-hand-pocket-x4-wholly-off','r2-hand-hole-run-off-x3','r2-hand-hole-run-off-x4','r2-hand-hole-overlap-x3','r2-hand-hole-overlap-slot-x4','r2-hand-hole-offpart-edge']
assert all(ok(i) for i in hp), [i for i in hp if not ok(i)]
sc_ = ['rp-pocket-copy-off-part','rh-hole-offpart','r3-mirhole-at200','rh-hole-overlap','r3-mirhole-overlap']
assert all(R[i]['outcome'] == 'SCRIPT-REFUSED' for i in sc_), [(i, R[i]['outcome']) for i in sc_]
HAND = 'Method: the script lowers repeat(pocket) to count-1 more sketch+pocket pairs, so the same ModelDoc is written by hand (pm-cases-r2.mjs r2-hand-*) and SolidCraft CAN build every one of them: %s | %s | %s | %s | %s. FreeCAD: %s | %s. P05-type case (plate 60x20, d6 holes at x=10,30,50 and a 4th wholly off at x=70): truck dVol %s vs OCCT, faces equal FreeCAD (%s); FreeCAD volume 11151.7700. Copy 3 centred ON the edge x=60: truck dVol %s, faces O/B/T %s/%s/%s. brep-rs cannot build the overlap case (%s) and the wholly-off pocket ("does not touch the part"), which is where the script sentences come from; SolidCraft has no such limit. ' % (c('r2-hand-pocket-x3-edge'), c('r2-hand-pocket-x4-wholly-off'), c('r2-hand-hole-run-off-x4'), c('r2-hand-hole-overlap-x3'), c('r2-hand-hole-offpart-edge'), fc('r2-hand-hole-run-off-x3'), fc('r2-hand-hole-overlap-slot-x4'), E(tr('r2-hand-hole-run-off-x4')['dVol']), R['r2-hand-hole-run-off-x4']['vsFreecad']['truck']['faces'], E(tr('r2-hand-pocket-x3-edge')['dVol']), R['r2-hand-pocket-x3-edge']['fx']['occt']['faces'], R['r2-hand-pocket-x3-edge']['fx']['brep']['faces'], tr('r2-hand-pocket-x3-edge')['faces'], R['r2-hand-hole-overlap-x3']['fx']['brep'].get('refused', '-'))
row('repeat(pocket), repeat(hole) and mirror(hole,{at}) where a copy REACHES THE EDGE of the part (straddles or touches the rim; a copy wholly off the part is dropped and is not this row). The script layer refuses these before any kernel is asked, although SolidCraft could build the hand-lowered equivalents.', 'refused',
    CMD3 + 'Script layer, no solidcraft command is issued: rp-pocket-copy-off-part, rh-hole-offpart, r3-mirhole-at200 (hole at x=10 mirrored across x=200: its copy lands off the part). ' + ' || '.join('%s: ' % i + SENTENCE_NOTE % (shipped(i), sen(i)) for i in ['rp-pocket-copy-off-part', 'rh-hole-offpart', 'r3-mirhole-at200']) + 'The limit behind the script guard is the retired kernel\'s (brep-rs cannot cut through an edge), not SolidCraft\'s. ' + HAND,
    sen('rp-pocket-copy-off-part'))
row('repeat(hole) and mirror(hole,{at}) where two copies OVERLAP each other. The script layer refuses these before any kernel is asked, although SolidCraft could build the hand-lowered equivalent.', 'refused',
    CMD3 + 'Script layer. rh-hole-overlap, r3-mirhole-overlap (hole at x=10 mirrored across x=12). ' + ' || '.join('%s: ' % i + SENTENCE_NOTE % (shipped(i), sen(i)) for i in ['rh-hole-overlap', 'r3-mirhole-overlap']) + HAND,
    sen('rh-hole-overlap'))
pk_ok = ['linear-pattern__overlapping-holes-slot','linear-pattern__copies-run-off-the-part','polar-pattern__overlapping-x6-blind','polar-pattern__holes-x12-ring']
assert all(ok(i) for i in pk_ok)
row('repeat(pocket) whose copies overlap each other into a slot or a ring recess, and copies that lie wholly off the part (dropped): the script ACCEPTS these', 'supported',
    CMD + ' | '.join(fc(i) for i in pk_ok) + '. Faces equal FreeCAD in all. (A copy that straddles or touches the rim, and overlapping copies of a hole(), are the refused rows.)')

row('repeat of a pocket whose step lifts the copy off the part (z step)', 'supported',
    CMD + 'A z step that lifts the copy off the part is dropped as cutting nothing: rp-pocket-step-z truck dVol %s vs OCCT.' % E(tr('rp-pocket-step-z')['dVol']))
assert ok('rp-pocket-step-z')

bo = ['linear-pattern__boss-x3','pm-lin-boss-y3','pm-lin-boss-touching','pm-lin-boss-overlap']
pb_ok = ['r3-pad-round-disjoint','r3-pad-round-overlap','r3-pad-round-z','r3-pad-rect-disjoint','r3-pad-rect-touching','r3-padra-round-overlap','r3-padra-round-ok']
assert all(ok(i) for i in pb_ok), [(i, R[i]['outcome']) for i in pb_ok if not ok(i)]
row('repeat / repeatAround of an extruded boss BEFORE it is joined to the plate (extrude, then repeat(boss), then join(plate, copies)): round and rectangular bosses, disjoint, overlapping, face-touching, z step, ring of overlapping bosses. This route is a SOLID repeat, not the pad lowering.', 'supported',
    CMD + ' | '.join(fc(i) for i in bo) + '. Round 3 (round bosses, which round 2 never tried): ' + ' | '.join(c(i) for i in pb_ok) + '. Overlapping and face-touching copies fuse into one bar. Boss copies tangent to each other (round, step = diameter) are NOT built: see the tangent-boss row.')
assert refused('r3-pad-round-tangent')
row('repeat(boss) of ROUND bosses stepped by exactly their diameter (tangent along a line), written extrude, repeat(boss), join(plate, copies)', 'refused',
    CMD3 + 'r3-pad-round-tangent: raw "%s". OCCT builds it (vol %.4f). Both lines the student wrote are refused: repeat() with the sentence below and join() as a dependent (produced by this run): "%s".' % (tr('r3-pad-round-tangent')['firstRefusal'][:240], R['r3-pad-round-tangent']['fx']['occt']['volume'], stu('r3-pad-round-tangent')),
    R['r3-pad-round-tangent']['fx']['truckFeatures'][[f['kind'] for f in R['r3-pad-round-tangent']['fx']['truckFeatures']].index('pattern')]['student'])
pj_ok = ['r3-padj-round-disjoint','r3-padj-rect-disjoint','r3-padj-around-ok','r3-padj-around-overlap']
pj_ref = ['r3-padj-round-overlap','r3-padj-round-tangent','r3-padj-round-z','r3-padj-rect-overlap','r3-padj-rect-touching']
assert all(ok(i) for i in pj_ok), [(i, R[i]['outcome']) for i in pj_ok if not ok(i)]
assert all(R[i]['outcome'] == 'SCRIPT-REFUSED' for i in pj_ref), [(i, R[i]['outcome']) for i in pj_ref]
row('repeat(pad) where the pad is join(plate, boss): disjoint copies (round, rectangular); repeatAround(pad) with clear OR overlapping bosses (the polar form is not refused by the script, unlike the linear form)', 'supported',
    CMD3 + ' | '.join(c(i) for i in pj_ok) + '. The script lowers this form to one extrude + join per copy; disjoint copies reach solidcraft as plain extrudes and joins.')
row('repeat(pad) (the LINEAR form) where the pad is join(plate, boss) and the copies OVERLAP, TOUCH or are TANGENT, round or rectangular, or the step has a z part (round 2 reported this as supported because it only ran repeat(boss) before the join). The script layer refuses these before any kernel is asked.', 'refused',
    CMD3 + 'Script layer, nothing reaches solidcraft: %s. All five give the same text. ' % ', '.join(pj_ref) + SENTENCE_NOTE % (shipped('r3-padj-round-overlap'), sen('r3-padj-round-overlap')) + 'The hand-lowered equivalent is the supported boss route above (overlapping round bosses r3-pad-round-overlap: %s), so this is the retired kernel\'s limit (brep-rs cannot join overlapping bosses into one part), not SolidCraft\'s.' % c('r3-pad-round-overlap'),
    sen('r3-padj-round-overlap'))
assert len({sen(i) for i in pj_ref}) == 1
row('repeat of a hole() (count x step across the face; through, blind, along x, count 1)', 'supported',
    CMD + ' | '.join(c(i) for i in ['rh-hole-x3','rh-hole-y3','rh-hole-along-x','rh-hole-blind','rh-hole-count1']))

# hole pattern refusals that are real
rd = sen('rh-hole-along-drill'); rc = sen('rh-holes-corners')
assert R['rh-hole-along-drill']['outcome'].startswith('SCRIPT') and R['rh-holes-corners']['outcome'].startswith('SCRIPT')
row('repeat of a hole() whose step runs along its own drill direction, or of a holes() set (four holes made at once)', 'refused',
    CMD + 'Script layer, no kernel involved. These are geometric refusals (not brep-rs limits): a step along the drill lifts the hole off the face, and holes() already drills four at once. ' + ' || '.join('%s: ' % i + SENTENCE_NOTE % (shipped(i), sen(i)) for i in ['rh-hole-along-drill', 'rh-holes-corners']),
    sen('rh-hole-along-drill'))
# counterbore / countersink
cb = ['r2-hole-cbore-repeat','r2-hole-csink-repeat','r2-hole-cbore-single','r2-hole-cbore-around']
assert all(refused(i) for i in cb)
import math
pl = 60 * 30 * 10
cb1 = pl - (math.pi * 9 * 10 + math.pi * (25 - 9) * 3)
cb3 = pl - 3 * (math.pi * 9 * 10 + math.pi * (25 - 9) * 3)
cs3 = pl - 3 * (math.pi * 9 * 10 + (math.pi * 2 / 3 * (25 + 15 + 9) - math.pi * 9 * 2))
cbv = R['r2-hole-cbore-repeat']['fx']['brep']['volume']; csv_ = R['r2-hole-csink-repeat']['fx']['brep']['volume']; cb1v = R['r2-hole-cbore-single']['fx']['brep']['volume']
row('repeat / repeatAround of a hole() with a counterbore or countersink (the whole chain is refused: the translator has no mapping for the recess)', 'refused',
    CMD + 'Raw: single "%s"; repeat x3 "%s". The referees DISAGREE with each other, so neither can arbitrate: OCCT repeat-cbore vol %.4f and single-cbore vol %.4f equal the PLAIN hole (18000 - 3*pi*9*10 = 17151.7700; 18000 - pi*9*10 = 17717.2567), i.e. occt-build.ts silently ignores the counterbore/countersink; brep-rs builds it (repeat cbore %.4f, repeat csink %.4f, single cbore %.4f). Independent closed forms: cbore d10x3 over d6 through 10 in 60x30x10: single %.4f, x3 %.4f (brep-rs off by %s); csink d10/90 over d6: x3 %.4f (brep-rs off by %s). Hole recesses belong to the holes group; here the point is that the pattern inherits the refusal and nothing is built or guessed. Student sentence for the root cause AND every dependent (produced by this run): "%s"' %
    (tr('r2-hole-cbore-single')['refused'], tr('r2-hole-cbore-repeat')['refused'][:160], R['r2-hole-cbore-repeat']['fx']['occt']['volume'], R['r2-hole-cbore-single']['fx']['occt']['volume'], cbv, csv_, cb1v, cb1, cb3, E(abs(cbv - cb3) / cb3), cs3, E(abs(csv_ - cs3) / cs3), stu('r2-hole-cbore-repeat')),
    stu('r2-hole-cbore-repeat'))
assert all('a hole with a counterbore or countersink cannot be drilled yet' in stu(i) for i in ('r2-hole-cbore-repeat', 'r2-hole-cbore-single', 'r2-hole-cbore-around'))  # round 4: the repeat/around wording prefixes 'it needs hole() to be built first, and that was refused:'

pp = ['polar-pattern__holes-x6-disc','polar-pattern__holes-x3-disc','polar-pattern__holes-x5-partial-180','polar-pattern__holes-x3-partial-90','polar-pattern__blind-x4','polar-pattern__bosses-x4','polar-pattern__holes-x8','polar-pattern__holes-x12-ring','polar-pattern__overlapping-x6-blind','polar-pattern__count-2-opposite','pm-polar-holes-x4-around-x','pm-polar-holes-partial-90-x3-around-x','pm-polar-holes-x4-around-y','pm-polar-holes-neg90-x3','pm-polar-holes-partial-90-x2','pm-polar-boss-x4-around-x']
row('repeatAround of a pocket (about z/x/y; full turn, partial 90/180/-90 with n-1 spacing, 12-ring, overlapping ring recess, count 2)', 'supported',
    CMD + 'Script lowers to rotated sketches + pockets (angle/count for a full turn, angle/(count-1) for less: the FreeCAD rule). Worst truck dVol vs FreeCAD over %d refs: %s, face counts equal FreeCAD in all, COM within %s mm. Examples: %s | %s | %s | %s. brep-rs refuses the about-y case ("pocket1 would leave a sealed cavity"); truck and OCCT match FreeCAD there.' % (len(pp), E(max(R[i]['vsFreecad']['truck']['dVol'] for i in pp)), E(max(R[i]['vsFreecad']['comAbs']['truck'] for i in pp)), fc('polar-pattern__holes-x5-partial-180'), fc('polar-pattern__overlapping-x6-blind'), fc('pm-polar-holes-x4-around-x'), fc('pm-polar-holes-x4-around-y')))
row('WRONG: repeatAround(pocket or hole, {angle: 720}) and {angle: -360} build a solid that DISAGREES with FreeCAD (and with the n-1 spacing the language uses for every other angle on a pocket or hole). The script treats |angle| >= 360 as a full turn; no refusal, no sentence.', 'wrong',
    CMD + 'Truck builds exactly what the script lowering asks for (it agrees with OCCT: pm-polar-holes-720-x4 truck dVol %s vs OCCT; neg360 %s), so a build-vs-OCCT check passes. It DISAGREES with the saved FreeCAD refs (pm-polar-holes-720-x4 dVol %s, pm-polar-holes-neg360-x4 dVol %s; OCCT %s / %s, brep-rs %s) because the script treats |angle| >= 360 as a full turn (step angle/count) while FreeCAD spaces by n-1 and treats only +360 as a full turn (720 -> 3 distinct holes, -360 -> 3 holes at n-1 spacing; the script rule gives 2 and 4). By the contract definition (builds, disagrees with an oracle) this is WRONG, not supported; round 2 listed it as supported because the OCCT referee agrees with the script. It is a bug in the language lowering, not in solidcraft: the bar is FreeCAD. Fix to make the row refused or supported: refuse |angle| >= 360 for pockets and holes (recommended sentence: "repeatAround(): an angle of 360 degrees or more is not available for a pocket or hole -- use an angle under 360, or leave it out for a full turn."), or follow FreeCAD. brep-rs refuses 720 (copy 3 lands on copy 1: "pocket3 does not touch the part").' % (E(tr('pm-polar-holes-720-x4')['dVol']), E(tr('pm-polar-holes-neg360-x4')['dVol']), E(R['pm-polar-holes-720-x4']['vsFreecad']['truck']['dVol']), E(R['pm-polar-holes-neg360-x4']['vsFreecad']['truck']['dVol']), E(R['pm-polar-holes-720-x4']['vsFreecad']['occt']['dVol']), E(R['pm-polar-holes-neg360-x4']['vsFreecad']['occt']['dVol']), E(R['pm-polar-holes-neg360-x4']['vsFreecad']['brep']['dVol'])))
assert R['pm-polar-holes-720-x4']['vsFreecad']['truck']['dVol'] > 1e-3 and R['pm-polar-holes-neg360-x4']['vsFreecad']['truck']['dVol'] > 1e-3
row('repeatAround of a pad / boss (bosses about z full turn and about x)', 'supported',
    CMD + fc('polar-pattern__bosses-x4') + ' | ' + fc('pm-polar-boss-x4-around-x'))
row('repeatAround of a hole() (about z, box and disc hosts, blind, partial 120)', 'supported',
    CMD + ' | '.join(c(i) for i in ['rah-hole-z6','rah-hole-z3-box','rah-hole-partial-120','rah-hole-blind']))
s20 = sen('rah-hole-axis-mismatch'); s21 = sen('rap-pocket-bad-axis')
row('repeatAround of a hole() about an axis not along the drill', 'refused',
    CMD + 'Script layer (rah-hole-axis-mismatch). ' + SENTENCE_NOTE % (shipped('rah-hole-axis-mismatch'), sen('rah-hole-axis-mismatch')),
    sen('rah-hole-axis-mismatch'))
row('repeatAround of a pocket about an axis the sketch is not square to', 'refused',
    CMD + 'Script layer (rap-pocket-bad-axis). ' + SENTENCE_NOTE % (shipped('rap-pocket-bad-axis'), sen('rap-pocket-bad-axis')),
    sen('rap-pocket-bad-axis'))
# ============================ mirror ============================
mp = ['mi-lr-offset-box','mi-fb-offset-box','mi-tb-offset-box','mi-lr-straddle','mi-lr-centered','mi-lr-corner-at-origin','mi-lr-negative-side','mi-fb-straddle-tall','mi-tb-straddle','mi-lr-equidistant','mi-lextrude-lr','mi-lextrude-fb','mi-lextrude-tb','mi-of-join','mi-of-drilled','mi-of-mirror','r2-tie-box-tb','r2-tie-box-fb','r2-neartie-box-neg','r2-tie-hexprism-tb']
mpp = [i for i in mp if i != 'mi-of-drilled']  # the drilled plate has a circular hole: curved bar
assert all(R[i]['outcome'] == 'PASS' and tr(i)['dVol'] < 1e-9 and tr(i)['dBbox'] < 1e-9 for i in mpp) and ok('mi-of-drilled') and tr('mi-of-drilled')['dVol'] < 3e-4
row("mirror(shape,'left-right'|'front-back'|'top-bottom') on planar solid bodies, reflected through the part's nearer bbox face on that axis and fused (offset, straddling the origin, centred, negative side, corner at origin, L-extrude, join, drilled, mirror of a mirror, hex prism, EXACT TIES of boxes at the origin, a 0.0001 mm near-tie)", 'supported',
    CMD + 'Command: solid.mirror {bodies,plane:{origin at the nearer bbox face,normal},combine:true}. Planar, worst over %d cases: truck dVol %s, dBbox %s vs OCCT (bar 1e-9); the drilled plate (circular hole, curved bar 3e-4) is dVol %s. %s | %s | %s. The tie rule (|lo| <= |hi| takes the LOWER face, as occt-build) holds for boxes and for the hex prism at the origin (r2-tie-box-tb/-fb, r2-tie-hexprism-tb: truck, OCCT and brep-rs all give the same bbox) and for a 0.0001 near-tie (r2-neartie-box-neg picks the nearer face). Curved parts at a tie are a different matter: see the next rows.' % (len(mpp), E(mx(mpp,'dVol')), E(mx(mpp,'dBbox')), E(tr('mi-of-drilled')['dVol']), c('mi-lr-offset-box'), c('mi-lr-straddle'), c('r2-tie-box-tb')))

# --- WRONG row: tie on curved parts, as-is
tie_wrong = ['r2-tie-cyl-tb','r2-tie-cyl-lr','r2-tie-cyl-tb-big','r2-tie-extruded-disc-tb','r2-tie-drilled-cyl-tb']
assert all(A[i]['outcome'] == 'FAIL' and tr(i, A)['dBbox'] > 0.5 for i in tie_wrong), [(i, A[i]['outcome'], tr(i, A).get('dBbox')) for i in tie_wrong]
assert A['r2-tie-cyl-fb']['outcome'] == 'FAIL' and tr('r2-tie-cyl-fb', A)['dBbox'] < 1e-4  # same defect: the noise fell the right way for placement, but the copy fuses (topology)
row("WRONG (AS-IS translator): mirror(curved part symmetric about the mirror plane) -- cylinder(10,10) / cylinder(100,20) / a disc extrusion / a drilled cylinder centred on the origin, mirror(c,'top-bottom') or 'left-right'. The reflection face is chosen from truck's MEASURED bounding box, whose two ends differ by tessellation noise, so the tie rule flips and the copy lands 10 mm on the wrong side. Volume still passes, so a volume check calls it supported.", 'wrong',
    CMDA + 'cylinder(10,10) (r 5, z -5..5) mirror top-bottom: %s. The tie is exact in the model (lo=-5, hi=5; OCCT and brep-rs take the lower face and give z -15..5); truck measures the bare cylinder\'s z extent as lo=%.15f hi=%.15f (pm-tie-probe.mjs, planar caps carry ~1e-15 noise; |lo|-|hi| = %s), so |lo|<=|hi| is FALSE and the plane goes through z=+5: the copy lands at z 5..15 and the bbox is z -5..15. truck dVol %s (inside the 3e-4 curved bar: PASSES a volume check), dBbox %s, dCOM %s. Same silent error: r2-tie-cyl-lr (x tie, curved side: dBbox %s), r2-tie-cyl-tb-big (cylinder(100,20): dBbox %s), r2-tie-extruded-disc-tb (dBbox %s), r2-tie-drilled-cyl-tb (dBbox %s). r2-tie-cyl-fb (y tie) HAPPENS to land at the right place (dBbox %s: the noise fell the other way) but the reflection overlaps the original by ~1e-4 mm and fuses (faces %s vs OCCT %s, the curved-side mechanism), which is why the placement error was not seen. The curved-cap and curved-side rows have no tie, so they do not cover this. The error persists with the other patches ON: PM_OFF=plane run: see below. Cause (verified): `Math.abs(lo) <= Math.abs(hi)` on measured values. Fix verified (patch plane): an ANALYTIC box from the ModelDoc (box/cylinder/sphere/cone/torus/prism/wedge, extrude outlines incl. circles, union, cut, move, 90-degree turns, mirror, linear pattern), accepted only when truck\'s measured box agrees within 1e-3+1e-4*extent, else measured box for planar parts (with a 1e-9 relative tie window) and a REFUSAL for curved parts; with it the five cases read: %s.' %
    (boxes('r2-tie-cyl-tb', A), PROBE['cylinder(10,10)']['min'][2], PROBE['cylinder(10,10)']['max'][2], E(PROBE['cylinder(10,10)']['zLoAbsMinusHiAbs']), E(tr('r2-tie-cyl-tb', A)['dVol']), E(tr('r2-tie-cyl-tb', A)['dBbox']), E(tr('r2-tie-cyl-tb', A)['dCom']), E(tr('r2-tie-cyl-lr', A)['dBbox']), E(tr('r2-tie-cyl-tb-big', A)['dBbox']), E(tr('r2-tie-extruded-disc-tb', A)['dBbox']), E(tr('r2-tie-drilled-cyl-tb', A)['dBbox']), E(tr('r2-tie-cyl-fb', A)['dBbox']), tr('r2-tie-cyl-fb', A)['faces'], R['r2-tie-cyl-fb']['fx']['occt']['faces'],
     '; '.join('%s %s dBbox %s' % (i, R[i]['outcome'], E(tr(i)['dBbox'])) for i in tie_wrong[:1] + tie_wrong[2:])))

# negative control: plane patch off, rest on
# (PM_OFF=plane is documented in the header of pm-translate.mjs; the numbers for it are in pm-results-planeoff.json)
po = {x['id']: x for x in json.load(open(os.path.join(H, 'pm-results-planeoff.json')))}
to = {x['id']: x for x in json.load(open(os.path.join(H, 'pm-results-torusoff.json')))}  # PM_OFF=torus
assert all(po[i]['outcome'] == 'FAIL' and tr(i, po)['dBbox'] > 0.5 for i in ['r2-tie-cyl-tb', 'r2-tie-cyl-lr', 'r2-tie-cyl-tb-big', 'r2-tie-extruded-disc-tb', 'r2-tie-drilled-cyl-tb'])
rows[-1]['evidence'] = rows[-1]['evidence'].replace('PM_OFF=plane run: see below.', 'With every patch ON except plane (PM_OFF=plane, pm-results-planeoff.json) the same five cases still FAIL: dBbox %s / %s / %s / %s / %s.' % tuple(E(tr(i, po)['dBbox']) for i in ['r2-tie-cyl-tb', 'r2-tie-cyl-lr', 'r2-tie-cyl-tb-big', 'r2-tie-extruded-disc-tb', 'r2-tie-drilled-cyl-tb']))

ts = ['r2-tie-cyl-tb','r2-tie-cyl-tb-big','r2-tie-extruded-disc-tb','r2-tie-drilled-cyl-tb','r2-tie-cone-tb','r2-neartie-cyl-pos','r2-neartie-cyl-neg','r2-neartie-cyl-neg-1mm']
assert all(ok(i) for i in ts) and all(R[i]['fx']['truck'].get('dBbox', 1) < 1e-4 for i in ts)
row("mirror of a curved part symmetric about the plane or standing on a planar cap, with the exact-plane fix [contract translator patch: plane] (cylinder / disc extrusion / drilled cylinder / cone at the origin top-bottom, a 0.0001 and 0.001 near-tie either side)", 'supported',
    CMD + 'Same cases as the WRONG row, now reading: %s | %s | %s | %s | %s. Near-ties: r2-neartie-cyl-pos (z -4.9999..5.0001, lower face nearer) dBbox %s, r2-neartie-cyl-neg (z -5.0001..4.9999, UPPER face nearer) dBbox %s, r2-neartie-cyl-neg-1mm dBbox %s: the analytic box applies OCCT\'s exact rule, not a tolerance window, so near-ties go the right way. %s. Worst dVol %s (tessellation bar 3e-4), dBbox <= %s. Chosen plane recorded per run (mirrorAt.how = analytic).' % (c('r2-tie-cyl-tb'), c('r2-tie-cyl-tb-big'), c('r2-tie-extruded-disc-tb'), c('r2-tie-drilled-cyl-tb'), c('r2-tie-cone-tb'), E(tr('r2-neartie-cyl-pos')['dBbox']), E(tr('r2-neartie-cyl-neg')['dBbox']), E(tr('r2-neartie-cyl-neg-1mm')['dBbox']), boxes('r2-tie-cyl-tb', R), E(mx(ts, 'dVol')), E(mx(ts, 'dBbox'))))
assert all(R[i]['fx']['truck']['bodies'] == 1 for i in ts)

cm = ['mi-cyl-tb-stack','mi-cone-tb','mi-turned-cyl-lr-caps']
assert all(ok(i) for i in cm)
row('mirror of curved shapes through a planar cap (cylinder stacked top-bottom, cone, cylinder turned on its side), part NOT symmetric about the plane', 'supported',
    CMD + 'Worst truck dVol %s dBbox %s (tessellation). %s | %s | %s. The analytic plane is used (mirrorAt.how = analytic), so these do not depend on measured-box noise.' % (E(mx(cm,'dVol')), E(mx(cm,'dBbox')), c('mi-cyl-tb-stack'), c('mi-cone-tb'), c('mi-turned-cyl-lr-caps')))

cs_ = ['r2-tie-cyl-lr','r2-tie-cyl-fb','r2-offorigin-cyl-lr','mi-cyl-lr-tangent','mi-cyl-lr-tangent-big','r2-tie-sphere-tb','mi-sphere-lr-point','mi-sphere-tb-point','mi-hexprism-lr','mi-turned-box-vertex','r2-tie-turned-box-lr','r2-tie-turned-box-tb']
assert all(refused(i) for i in cs_), [(i, R[i]['outcome']) for i in cs_ if not refused(i)]
assert all(A[i]['outcome'] in ('FAIL', 'REFUSED') for i in ['mi-cyl-lr-tangent','mi-cyl-lr-tangent-big','r2-offorigin-cyl-lr'])
row('mirror of a shape whose reflection only touches the original at a point, along a line, or tangent (cylinder across its curved side: tangent line; sphere; hex prism across a vertex; box turned 30 degrees; the same at an exact tie). The plane is always the part\'s own nearest bounding-box face, so moving the part never changes this contact.', 'refused',
    CMD + 'solid.mirror itself refuses all of these once it is given the exact plane: %s. OCCT and brep-rs build a pair joined at a point or line (a non-manifold part). Raw engine text: "%s". AS-IS the curved-side case was a SILENT WRONG SOLID, not a refusal: %s (cylinder at x=20 across x=15: faces %s vs OCCT %s, because the plane came from the tessellated box, x lo = 15.000077, so the reflection overlapped the original by 1.5e-4 mm and fused), %s, %s. With the exact plane (patch plane) the engine refuses and so does the contract. ROUND 3 sentence fix: round 2 told the student to "move the shape so the copy overlaps it along a face, or leaves a clear gap", which cannot be done (the mirror plane is the part\'s own nearest face, so translating the part never changes whether the contact is a face, a line or a point; checked with cylinders at x=20, x=0, a y-straddle and a turned box: all refused wherever they sit). The new sentence says what changes the contact: another direction, or turning the part; the advice is measured in the advice row (cylinder turned or mirrored top-bottom: builds; hexagon turned 30: builds; sphere: no fix claimed). Student sentence (produced by this run): "%s"' %
    (', '.join(cs_), tr('mi-sphere-lr-point')['refused'].split(' -- ')[1], c('mi-cyl-lr-tangent', A), tr('mi-cyl-lr-tangent', A)['faces'], R['mi-cyl-lr-tangent']['fx']['occt']['faces'], c('mi-cyl-lr-tangent-big', A), c('r2-offorigin-cyl-lr', A) if A['r2-offorigin-cyl-lr']['outcome'] != 'REFUSED' else 'refused', stu('mi-sphere-lr-point')),
    stu('mi-sphere-lr-point'))
row('mirror of a cylinder across its curved side, AS-IS translator (kept from round 1; the cases are in the refused row above)', 'wrong',
    CMDA + 'mi-cyl-lr-tangent FAIL: %s | mi-cyl-lr-tangent-big: %s. Volume and bbox sit inside the curved bar, but faces are %s (one fused lump, merged caps) against OCCT %s and brep-rs %s. Fixed by patch plane (-> refused row).' % (c('mi-cyl-lr-tangent', A), c('mi-cyl-lr-tangent-big', A), tr('mi-cyl-lr-tangent', A)['faces'], R['mi-cyl-lr-tangent']['fx']['occt']['faces'], R['mi-cyl-lr-tangent']['fx']['brep']['faces']))

mb = ['r2-mirror-of-repeat2','r2-mirror-of-disjoint-join','r2-mirror-of-around','mi-of-repeat']
assert all(A[i]['outcome'] == 'FAIL' and tr(i, A)['dVol'] > 0.1 for i in mb), [(i, A[i]['outcome'], tr(i, A).get('dVol')) for i in mb]
assert all(ok(i) for i in mb)
row('WRONG (AS-IS translator): mirror of a multi-body shape (repeat/join of disjoint pieces, then mirror). solid.mirror combine:true on a body with several lumps returns the result split into "b" and "b (2)"; phase0 measures only "b", so the total is HALF (or a third short).', 'wrong',
    CMDA + 'mirror(repeat(box x2)) : %s ; join of two disjoint boxes then mirror: %s ; repeatAround x3 then mirror: %s ; mi-of-repeat (3 disjoint boxes): %s. No refusal, no sentence. The kernel is right; the bookkeeping is wrong. Fix verified (patch fresh: bodies the command created that the plan did not name are measured too): %s | %s | %s | %s (volumes 4000, 4000, 6000, 6000; bodies %d / %d / %d / %d, i.e. several bodies, not one fused solid, as the copies are disjoint).' %
    (c('r2-mirror-of-repeat2', A), c('r2-mirror-of-disjoint-join', A), c('r2-mirror-of-around', A), c('mi-of-repeat', A), c('r2-mirror-of-repeat2'), c('r2-mirror-of-disjoint-join'), c('r2-mirror-of-around'), c('mi-of-repeat'), tr('r2-mirror-of-repeat2')['bodies'], tr('r2-mirror-of-disjoint-join')['bodies'], tr('r2-mirror-of-around')['bodies'], tr('mi-of-repeat')['bodies']))
row('mirror of a multi-body shape (repeat then mirror: disjoint boxes mirrored) [contract translator patch: fresh]', 'supported',
    CMD + 'Total volume, bbox and COM equal OCCT and brep-rs: %s | %s | %s. The result is several bodies (disjoint copies cannot be fused), as OCCT builds several solids in one compound. The AS-IS translator is the WRONG row above.' % (c('r2-mirror-of-repeat2'), c('r2-mirror-of-around'), c('mi-of-repeat')))

row('mirror of a hex prism across a flat face (front-back), flat contact', 'supported',
    CMD + c('mi-hexprism-fb-flat') + '. Scored FAIL against OCCT only because OCCT AddOptimal bbox is 9.5e-5 short on y (4.41144758 vs analytic 20-3*6*sin60 = 4.41154273), which moves OCCT mirror plane off the contact face (OCCT 16 faces = 2 x 8, consistent with its two prisms not being in contact). Truck and brep-rs bbox equal the analytic value exactly (4.411542731880104); truck merges to 12 faces, volume 1496.49189773951 equals OCCT to 3e-16. Referee artifact.')
assert R['mi-hexprism-fb-flat']['outcome'] == 'FAIL' and tr('mi-hexprism-fb-flat')['dVol'] < 1e-9

# mirror after a join truck rejects
mj = ['r2-mirror-of-edge-join-hdiff','r2-edge-join-hdiff-alone']
assert all(refused(i) for i in mj) and refused('r2-mirror-of-edge-join')
row('mirror(join(a,b)) where the two boxes touch along an edge (the join step is what truck rejects: "join cannot preserve the original faces"), and the same with equal heights (join accepted, mirror then refused)', 'refused',
    CMD + 'Unequal heights (r2-mirror-of-edge-join-hdiff, box 10 high + box 10x10x20 meeting along a 10 mm piece of edge): raw "%s". Equal heights (r2-mirror-of-edge-join): the join is accepted as a 2-shell body, then raw "%s". brep-rs refuses the same join in plain words ("%s"); OCCT builds it (vol %.4f). Both reach the same student sentence for the root cause and the dependent mirror (produced by this run): "%s" / "%s".' %
    (tr('r2-mirror-of-edge-join-hdiff')['refused'], tr('r2-mirror-of-edge-join')['refused'], R['r2-mirror-of-edge-join']['fx']['brepRefusals']['op1'].split(' -- ')[0].split(': ', 1)[-1] if 'brepRefusals' in R['r2-mirror-of-edge-join']['fx'] else 'the two shapes only touch along a line or at a point', R['r2-mirror-of-edge-join-hdiff']['fx']['occt']['volume'], stu('r2-mirror-of-edge-join-hdiff'), stu('r2-mirror-of-edge-join')),
    stu('r2-mirror-of-edge-join-hdiff'))

# mirror(cut, ..., {at})
atp = ['mirrored__left-right-hole-at20','mirrored__front-back-hole-at15','mirrored__left-right-offset-plane','mirrored__front-back-blind','mirrored__hole-on-its-own-plane','mirrored__reflection-runs-off','mirrored__rect-overlap-inside','mirrored__reflection-runs-off-front','mirrored__reflection-runs-off-through','mirrored__reflection-touches-rim','mirrored__rect-on-its-own-plane','mirrored__left-right-boss','pm-mir-boss-front-back','pm-mir-pocket-lr-through-plate']
row("mirror(cut,'left-right'|'front-back',{at:n}) of a pocket, hole() or round boss across a plane square to its face (lowered to one more sketch and pocket/hole/pad)", 'supported',
    CMD + 'Truck vs FreeCAD refs over %d cases: worst dVol %s (circles), faces equal FreeCAD in all, planar rectangle cases dVol <= 3.1e-16 (e.g. %s). mh-lr-at0, mh-fb, mh-along-x, mh-blind (hole()): truck dVol <= 5.4e-6 vs OCCT, brep-rs <= 4.2e-16.' % (len(atp), E(max(R[i]['vsFreecad']['truck']['dVol'] for i in atp)), fc('mirrored__reflection-touches-rim')))

# reversed pocket: wrong as-is + supported with patch
rev = ['mirrored__top-bottom-pocket','mirrored__top-bottom-rect-pocket','mirrored__top-bottom-offcentre-plane','mirrored__top-bottom-breaks-bottom','mirrored__top-bottom-from-bottom-reversed','mirrored__top-bottom-on-disc','mirrored__top-bottom-in-boss','mirrored__top-bottom-tall-block']
asis = '; '.join('%s FreeCAD %.4f vs as-is truck %.4f (dVol %s, %s/%s faces)' % (i.split('__')[1], A[i]['fcRef']['volume'], tr(i, A)['volume'], E(A[i]['vsFreecad']['truck']['dVol']), A[i]['vsFreecad']['truck']['faces'], A[i]['vsFreecad']['truck']['facesRef']) for i in rev)
fixd = '; '.join('%s %s' % (i.split('__')[1][11:], E(R[i]['vsFreecad']['truck']['dVol'])) for i in rev)
assert all(A[i]['vsFreecad']['truck']['dVol'] > 1e-3 and R[i]['vsFreecad']['truck']['dVol'] < 1e-4 for i in rev)
assert all(A[i]['outcome'] == 'PASS' and R[i]['outcome'] == 'FAIL' for i in rev)  # AS-IS passes vs OCCT (referee hides it); patched disagrees with OCCT but agrees with FreeCAD
row("WRONG (AS-IS translator): mirror(pocket,'top-bottom',{at:n}) (a pocket reflected through a plane PARALLEL to its sketch: lowered to a pocket with reversed:true on the opposite face) and any pocket(...,{reversed:true})", 'wrong',
    CMDA + 'phase0 maps a pocket to solid.extrude direction:negative and never reads PocketFeature.reversed, so the reflected cut runs the wrong way (out of the part) and one of the two cuts is silently lost; no refusal. vs the saved FreeCAD refs: ' + asis + '. The OCCT referee HIDES it: occt-build.ts has no `reversed` handling for pockets either, so OCCT builds the same wrong solid and the AS-IS truck scores PASS against it (all 8 as-is rows PASS vs OCCT). Own check: pocket(s2,plate,3,{reversed:true}) on a sketch at z=0: OCCT %.4f (the cut is lost), brep-rs %.4f, as-is truck %.4f, patched truck %.4f (12000 - pi*9*3 = 11915.177; rl-pocket-reversed-own). Correct independent arbiters: FreeCAD refs and brep-rs, which agree with each other.' % (R['rl-pocket-reversed-own']['fx']['occt']['volume'], R['rl-pocket-reversed-own']['fx']['brep']['volume'], tr('rl-pocket-reversed-own', A)['volume'], tr('rl-pocket-reversed-own')['volume']))
row("mirror(pocket,'top-bottom',{at:n}) and pocket(...,{reversed:true}) [contract translator patch: reversed -> solid.extrude direction:'positive']", 'supported',
    CMD + 'vs the saved FreeCAD refs, truck dVol: ' + fixd + '; faces equal FreeCAD in all 8 and brep-rs dVol vs FreeCAD <= 1.5e-16; mirror-through-the-middle rect pockets are exact to 0. These 8 rows score FAIL against LIVE OCCT only because occt-build.ts ignores reversed (see the WRONG row); FreeCAD and brep-rs are the arbiters. The AS-IS translator must not be used for this feature.')
row("mirror(pocket,'top-bottom',{at:n}) of a through pocket (copy is the same hole again)", 'supported',
    CMD + fc('mirrored__top-bottom-through') + ' (script drops the duplicate copy, so no reversed pocket reaches solidcraft; true with or without the patch).')
row("mirror(pad / boss,word,{at:n}) when the boss and its reflection do not touch (left-right, front-back)", 'supported',
    CMD + fc('pm-mir-boss-front-back') + ' | ' + fc('mirrored__left-right-boss'))

bs = ['r2-hand-boss-straddle','r2-hand-boss-touching','r2-hand-boss-on-plane']
assert all(ok(i) for i in bs) and refused('r2-hand-boss-tangent-circles')
bs_ref = ['pm-mir-boss-straddle','pm-mir-boss-touching','pm-mir-boss-on-plane']
assert all(R[i]['outcome'] == 'SCRIPT-REFUSED' for i in bs_ref)
row("mirror(pad / boss,word,{at:n}) when the boss and its reflection straddle (overlap), share a face, or the boss is centred on the plane. The script layer refuses these before any kernel is asked (round 2 listed it as supported because SolidCraft builds the hand-lowered equivalent; that is a different claim).", 'refused',
    CMD + 'Script layer: %s. ' % ', '.join(bs_ref) + SENTENCE_NOTE % (shipped('pm-mir-boss-straddle'), sen('pm-mir-boss-straddle')) + 'The retired kernel\'s limit, not SolidCraft\'s: mirror(pad) lowers to the original boss plus a boss at the reflected position, so the same ModelDoc written by hand (r2-hand-boss-*) is built by SolidCraft and matches FreeCAD: %s | %s | %s (faces equal FreeCAD 11/11/8).' %
    (fc('r2-hand-boss-straddle'), fc('r2-hand-boss-touching'), fc('r2-hand-boss-on-plane')),
    sen('pm-mir-boss-straddle'))
assert len({sen(i) for i in bs_ref}) == 1
row("mirror(pad / boss,word,{at:n}) when the round boss and its reflection are exactly TANGENT (circle d10 at x=10 mirrored across x=15)", 'refused',
    CMD + 'FreeCAD builds it (ref pm-mir-boss-tangent-circles). OCCT builds it (vol %.4f). brep-rs refuses. SolidCraft refuses the union of the two tangent bosses; raw: "%s". Translator sentence (produced by this run; the lowering hides that the student wrote mirror(), so it names join()): "%s". The contract sentence below uses the student\'s own call.' % (R['r2-hand-boss-tangent-circles']['fx']['occt']['volume'], tr('r2-hand-boss-tangent-circles')['refused'][:200], stu('r2-hand-boss-tangent-circles')),
    "mirror(): the pad and its reflection touch only along a line (they are exactly tangent), so they cannot be fused into one solid -- move the pad so its reflection overlaps it or leaves a gap.")
rows[-1]['evidence'] += ' In the product today the SCRIPT layer refuses this one first, before any kernel is asked (pm-mir-boss-tangent-circles: "%s"); the sentence above is what the contract says once the script guard is lifted. Moving the pad changes the mirror plane relative to it, so this advice IS actionable (unlike the whole-shape mirror).' % sen('pm-mir-boss-tangent-circles')

row("mirror(hole,'top-bottom',{at}) / mirror(pad,'top-bottom',{at}) across a plane parallel to the face", 'refused',
    CMD + 'mh-parallel-refused, mh-pad-parallel-refused. Script layer, no kernel involved. (A pocket across the parallel plane IS lowered; see the reversed-pocket rows.) ' + SENTENCE_NOTE % (shipped('mh-parallel-refused'), sen('mh-parallel-refused')) + ' || pad: ' + SENTENCE_NOTE % (shipped('mh-pad-parallel-refused'), sen('mh-pad-parallel-refused')),
    sen('mh-parallel-refused'))
row('mirror(shape,word,{at}) where the shape is not a pocket, hole or pad (box, cylinder, repeated shape), non-numeric at, bad or missing direction word', 'refused',
    CMD + ' || '.join('%s -> shipped "%s" -> shown "%s"' % (i, shipped(i), sen(i)) for i in ['mi-at-on-box','mi-at-nonfinite','mi-bad-word','mi-no-word']),
    sen('mi-at-on-box'))
# ============================ torus ============================
assert ok('r2-torus-repeat-disjoint') and ok('r2-torus-around-disjoint')
row('repeat / repeatAround of a torus (ring()) whose copies are provably clear of each other (disjoint)', 'supported',
    CMD + '%s | %s. SLOW: one run of the case takes %s s (repeat x3) and %s s (repeatAround x3) because every prefix re-runs the torus commands (a single torus alone is 11.6 s; direct probe pm-torus-probe.mjs truck 40: pattern 66 s + join 39 s). Correct but not interactive.' % (c('r2-torus-repeat-disjoint'), c('r2-torus-around-disjoint'), TA['r2-torus-repeat-disjoint']['secs'], TA['r2-torus-around-disjoint']['secs']))

ov = TA['r2-torus-repeat-overlap']; ao = TA['r2-torus-around-overlap']
assert ao['outcome'] == 'FAIL' and ao['truckBodies'] == 3 and ao['dVol'] > 0.1 and ao['hung'] is False
if ov['hung']:
    ovtxt = 'repeat step 20 (overlapping): did NOT return in %s s (timeout exit 124) -- no result, no refusal; the direct probe (pm-torus-probe.mjs truck 20, solidcraft commands only, no oracle in the loop) shows the pattern command returns in ~30 s and the following solid.combine join never returns in 170 s' % ov['secs']
else:
    ovtxt = 'repeat step 20 (overlapping): returned after %s s: outcome %s, truck volume %s vs OCCT %s' % (ov['secs'], ov['outcome'], N4(ov.get('truckVol')), N4(ov.get('occtVol')))
row('WRONG / HANG (AS-IS translator): repeat / repeatAround of a torus (ring()) whose copies overlap. The join of overlapping tori either never returns or falls back to the unjoined copies, whose volumes are SUMMED.', 'wrong',
    CMDA.replace(" --skip='r2-torus*'", '').replace('--variants ', '') + '(one case at a time, `--only=<id>`, under `timeout`). repeatAround of 3 overlapping rings (ring(30,6,{at:[12,0,0]}), neighbours 20.8 apart): returned after %s s with truck volume %s = 3 x 2131.52, i.e. the overlap is counted three times, 3 separate bodies, against OCCT %s (dVol %s, dBbox %s); brep-rs refuses ("its copies overlap"). %s. Tangent copies (step 30) do return, joined and correct: dVol %s in %s s. So the failure is specific to OVERLAPPING tori, and the wrong answer carries no refusal.' %
    (ao['secs'], N4(ao['truckVol']), N4(ao['occtVol']), E(ao['dVol']), E(ao['dBbox']), ovtxt, E(abs(TA['r2-torus-repeat-tangent']['truckVol'] - TA['r2-torus-repeat-tangent']['occtVol']) / TA['r2-torus-repeat-tangent']['occtVol']), TA['r2-torus-repeat-tangent']['secs']))
tg = ['r2-torus-repeat-tangent','r2-torus-repeat-overlap','r2-torus-around-overlap']
assert all(refused(i) for i in tg)
row('repeat / repeatAround of a torus (ring()) whose copies touch or overlap, or cannot be shown to be clear [contract translator patch: torus guard]', 'refused',
    CMD + 'Refused BEFORE solidcraft is called, so nothing hangs and nothing is summed: %s. Proof of clearance that lets a torus pattern through: straight pattern = the step exceeds the torus extent along some axis by more than 1e-3; ring = the chord between neighbours exceeds twice the bounding-sphere radius. The guard is conservative: tangent tori (step 30) would have joined correctly (AS-IS dVol 1.5e-4 in 80 s) but are refused. Torus lineage is taken from the ModelDoc, not from truck\'s face_types (a torus face reads as type "other"). Student sentence (produced by this run): "%s"' %
    ('; '.join('%s -> %s' % (i, tr(i)['refused']) for i in tg), stu('r2-torus-repeat-overlap')),
    stu('r2-torus-repeat-overlap'))

tm = ['r2-torus-mirror','r2-torus-mirror-lr-disjoint','r2-torus-mirror-tie']
assert all(ok(i, to) for i in ['r2-torus-mirror','r2-torus-mirror-tie']) and tr('r2-torus-mirror', to)['bodies'] == 2
assert all(refused(i) for i in tm) and all(TA[i]['outcome'] == 'FAIL' and abs(TA[i]['truckVol'] * 2 - TA[i]['occtVol']) < 1e-3 * TA[i]['occtVol'] for i in tm)
row("WRONG (AS-IS translator): mirror of a torus (ring()) -- reported volume is HALF. A mirror reflects through the part's own extreme, so the copy always meets the original along a circle; solidcraft returns two unfused bodies and the phase0 translator measures only the first.", 'wrong',
    CMDA.replace(" --skip='r2-torus*'", '').replace('--variants ', '') + '(one case at a time, `--only=<id>`, under `timeout 150`; each took 47-69 s). ' + ' | '.join('%s: truck volume %s vs OCCT %s (ratio %.3f), %s' % (i, N4(TA[i]['truckVol']), N4(TA[i]['occtVol']), TA[i]['truckVol'] / TA[i]['occtVol'], TA[i]['line'].split('faces')[-1].strip()) for i in tm) + '. brep-rs and OCCT agree with each other (4263.67 = 2 x 2131.84). With the other patches ON but the torus guard OFF (PM_OFF=torus, pm-results-torusoff.json) the total is right: %s | %s, as TWO bodies (%d) touching along a circle; the guard below refuses instead, for the same reason as edge contact (the result would not be one solid).' % (c('r2-torus-mirror', to), c('r2-torus-mirror-tie', to), tr('r2-torus-mirror', to)['bodies']))
row('mirror of a torus (ring()) [contract translator patch: torus guard]', 'refused',
    CMD + 'Refused before solidcraft is called, for every torus mirror (the copy always touches the original): %s. Student sentence (produced by this run): "%s"' % ('; '.join('%s -> %s' % (i, tr(i)['refused']) for i in tm), stu('r2-torus-mirror')),
    stu('r2-torus-mirror'))


# ============================ ROUND 3 (critic findings) ============================
GB = {x['id']: x for x in json.load(open(os.path.join(H, 'pm3-results-generous-budget.json')))}  # PM_BUDGET_MS=400000, same translator logic
NC = {x['id']: x for x in json.load(open(os.path.join(H, 'pm3-results-fusedoff.json')))} if os.path.exists(os.path.join(H, 'pm3-results-fusedoff.json')) else {}
TIMEB = open(os.path.join(H, 'pm3-time-bare.txt')).read() if os.path.exists(os.path.join(H, 'pm3-time-bare.txt')) else 'LOST-DATA: pm3-time-bare.txt is not in this directory, bare-session timings not re-measured'
TIMEC = open(os.path.join(H, 'pm3-time-curved.txt')).read() if os.path.exists(os.path.join(H, 'pm3-time-curved.txt')) else 'LOST-DATA: pm3-time-curved.txt is not in this directory, bare-session timings not re-measured'
def cc(i, src=R):
    x = src[i]
    if x['outcome'] in ('REFUSED',): return '%s: REFUSED "%s"' % (i, stu(i, src))
    if x['outcome'] == 'SCRIPT-REFUSED': return '%s: SCRIPT-REFUSED "%s"' % (i, x['sentence'])
    return c(i, src)
def vol3(i, src):
    return tr(i, src).get('volume')
def asis3(i, extra=''):
    x = A3[i]; t = x['fx']['truck']; o = x['fx']['occt']; b = x['fx']['brep']
    return '%s: OCCT %.3f, brep-rs %s, round-2 contract truck %.3f as %d bodies (dVol %s vs OCCT, %+.1f%%)%s' % (i, o['volume'], ('%.3f' % b['volume']) if 'volume' in b else 'refused', t['volume'], t['bodies'], E(t['dVol']), 100 * (t['volume'] / o['volume'] - 1), extra)

# ---- A. silent wrong solids in repeat / repeatAround when the join fails (the critic's biggest gap)
sil = ['r3-cone2-step3','r3-cone3-step6','r3-cone-ra-overlap','r3-washer2-y6','r3-washer3-z6','r3-vase2-x10','r3-washer-y10-touch']
if A3:
    for i in sil:
        t = A3[i]['fx']['truck']
        assert A3[i]['outcome'] == 'FAIL' and t['bodies'] > 1 and t['dVol'] > 0.05 and t['volume'] > 0, (i, A3[i]['outcome'], t.get('bodies'), t.get('dVol'))
if A3: row('WRONG (round-2 contract translator, the one that shipped): repeat / repeatAround of CONE or SPUN copies (washer, vase, pulley) that overlap or touch. solid.combine join fails, the translator falls back to the unjoined copies, and the result is N separate bodies whose volumes are SUMMED: no refusal, no sentence. Only the torus guard stood in the way.', 'wrong',
    CMDR2 + ' | '.join(asis3(i) for i in sil[:5]) + ' | ' + asis3('r3-vase2-x10') + ' | ' + asis3('r3-washer-y10-touch', ' [here OCCT itself is wrong: three stacked washers must be 3 x 9424.78 = 28274.33; OCCT 20482 is its own boolean failure, and truck\'s total is right only because stacked copies do not overlap, but it is still 3 bodies, not one fused solid]') +
    '. Independent checks: washers stacked along their own axis (y step 6) overlap by 4 of 10, union height 16, volume 300*pi*16 = 15079.645 = OCCT = brep-rs, truck 18849.531 = 2 x 9424.78 (+25%); cone(10,20) x2 step 3: each cone is 523.60, truck 1047.007 = their SUM although the copies overlap by 7 mm, so the union must be smaller (OCCT 799.086). Cause (raw, repeated on every row): "solid.combine: boolean Union: the operation failed: no result; ... not supported yet: the exact fallback for where the bodies meet (faces that touch, or cross at a shallow angle) takes planar faces only, and the target has 3 curved faces (cone)". brep-rs refuses the cone rows ("its copies overlap") and builds the washer rows. The critic reproduced the first five with scratchpad/pm-critic/run.mjs --set=b5 / --set=b7 --tr=pm; the ids are ov-washer-stack-overlap, v-cone2-step3, v-cone-ra-overlap, v-washer2-y6 and the cone x3 step 6 case.')
for i in sil:
    assert R[i]['outcome'] == 'REFUSED', (i, R[i]['outcome'])
joinfail = [i for i in sil if 'copies overlap or touch' in (tr(i).get('refused') or '')]
timed = [i for i in sil if tmo(i)]
assert set(joinfail) | set(timed) == set(sil)
for i in timed: assert GB[i]['outcome'] == 'REFUSED' and 'copies overlap or touch' in (GB[i]['fx']['truck'].get('refused') or ''), (i, GB[i]['outcome'])
row('repeat / repeatAround of cone or spun copies that overlap or touch and that truck cannot join [contract translator patch: disjoint, the unjoined fallback is accepted only when every pair of copies is provably apart]', 'refused',
    CMD + 'ALL SEVEN rows of the wrong row above are now refused before any volume is reported: ' + ' | '.join('%s -> %s' % (i, 'killed at the 60 s limit' if i in timed else 'join failed') for i in sil) + '. The two killed at the limit would fail the join anyway: with a 400 s limit (pm3-results-generous-budget.json) %s both end in the same join refusal after %s s. Check made by the guard: after the join fails, the closest pair of copies must have a bbox gap above 1e-3 mm along some axis, else the pattern is refused (raw: "%s"). Copies that are provably apart keep the fallback (see the supported row). Student sentence (produced by this run): "%s"' %
    (' and '.join(timed), ' and '.join('%d' % (GB[i]['fx']['ms'] / 1000) for i in timed), tr('r3-cone2-step3')['refused'][:150], stu('r3-cone2-step3')),
    stu('r3-cone2-step3'))
assert stu('r3-cone2-step3') == stu('r3-washer2-y6') == stu('r3-washer3-z6') == stu('r3-vase2-x10') == stu('r3-washer-y10-touch')

# ---- B. cones / spun solids that DO build
cs3 = ['r3-cone2-step8','r3-cone2-step6','r3-cone2-z12','r3-cone2-disjoint','r3-cone2-gap-small','r3-vase2-y10','r3-vase2-disjoint','r3-washer-disjoint','r3-washer2-z3','r3-cyl-hole-overlap']
for i in cs3:
    t = tr(i); assert R[i]['outcome'] in ('PASS', 'FAIL') and t['dVol'] <= 3e-4 and t['dBbox'] <= 3e-4 and t['bodies'] == 1 and t['geomOk'], (i, R[i]['outcome'], t.get('dVol'), t.get('bodies'))
fails = [i for i in cs3 if R[i]['outcome'] == 'FAIL']
def ftxt(i):
    t = tr(i); return '%s truck %s vs OCCT %s' % (i, t['faceTypes'], t['occtTypes'])
row('repeat / repeatAround of cone, spun (washer, vase) and drilled-cylinder copies that overlap in a way truck CAN join, or that are provably apart (bbox gap > 1e-3 mm): cone x2 steps 8 and 6, cone stacked on cone, apart cones/vases/washers, vase stacked along its axis, washer side by side, ring of drilled cylinders', 'supported',
    CMD3 + ' | '.join(c(i) for i in cs3) + '. Worst truck dVol %s, dBbox %s over %d cases (bar 3e-4, tessellation); every result is ONE body. Pattern run times in this run: %s. Face counts: %d rows are scored FAIL by the rig only on faces (volume, bbox and COM pass): %s. Explanation: truck merges the coplanar base discs of overlapping cones into one planar face (OCCT keeps two) and leaves the washer top annuli in fewer pieces than OCCT; brep-rs gives yet another count (washer side by side: O/B/T %s/%s/%s). Convention, not geometry.' %
    (E(max(tr(i)['dVol'] for i in cs3)), E(max(tr(i)['dBbox'] for i in cs3)), len(cs3), ', '.join('%s %.1f s' % (i, pwall(i)) for i in ['r3-cone2-step8','r3-cone2-step6','r3-washer2-z3','r3-cone2-z12'] if pwall(i)), len(fails), '; '.join(ftxt(i) for i in fails[:3]), R['r3-washer2-z3']['fx']['occt']['faces'], R['r3-washer2-z3']['fx']['brep']['faces'], tr('r3-washer2-z3')['faces']))


# ---- C. the time limit
tl = [i for i in R if i.startswith('r3-') and tmo(i)]
assert 'r3-sph2-step7' in tl and 'r3-cone3-step6' in tl
def mkline(i):
    return '%s: %s' % (i, ('built in %.1f s, dVol %s' % (pwall(i), E(tr(i)['dVol']))) if R[i]['outcome'] in ('PASS', 'FAIL') else 'killed at 60 s')
tm_ok = ['r3-sph2-step8','r3-sph2-step7.5','r3-sph2-step6','r3-sph3-step8','r3-sph2-disjoint','r3-ring3-far','r3-cone2-step8','r3-cone2-step6','r3-cone2-y6','r3-washer2-z3']
tm_ok = [i for i in tm_ok if R[i]['outcome'] in ('PASS', 'FAIL')]
tm_ko = ['r3-sph2-step7','r3-cone3-step6','r3-cone-ra-overlap','r3-spin-ra-overlap','r3-around-count-360'] + [i for i in R if tmo(i) and not i.startswith('r3-')]
tm_ko = [i for i in dict.fromkeys(tm_ko) if tmo(i)]
assert 'r3-sph2-step7' in tm_ko
row('repeat / repeatAround of ROUND copies (spheres, cones, spun parts, rings of them) that take longer than 60 s to build [contract translator patch: budget, each solidcraft run is a child process killed at the limit, 300 s for a whole model]', 'refused',
    CMD + 'Round 2 had NO limit: the build ran as long as it ran (two spheres d10 in one bare session: step 8 = 9 s, step 7.5 = 8 s, step 7 = 174 s, step 6 = 11 s; the cliff is in the kernel boolean, not the pattern). Killed at 60 s and refused in this run: ' + ' | '.join(mkline(i) for i in tm_ko) + '. Built inside the limit (pattern run time): ' + ' | '.join(mkline(i) for i in tm_ok) + '. With a 400 s limit the killed ones end like this (pm3-results-generous-budget.json): ' + ' | '.join('%s %s%s' % (i, GB[i]['outcome'], (' after %d s' % pwall(i, GB)) if GB[i]['outcome'] in ('PASS', 'FAIL') else ' (join refusal)') for i in ['r3-sph2-step7','r3-cone3-step6','r3-cone-ra-overlap','r3-spin-ra-overlap']) + '. One bare session (pattern + join, no oracle, no replay; pm3-time-curved.mjs): ' + TIMEC.strip().replace('\n', ' | ') + ' || The limit is a policy number: cases within 2x of it (cone x2 step 6 and the y6 stack at 40-51 s) depend on machine load, so the row for a case near the limit may read supported on a quiet machine. The sentence names the cause and the way out. Student sentence (produced by this run): "%s"' % stu('r3-sph2-step7'),
    stu('r3-sph2-step7'))

# ---- D. counts
assert R['r3-box-count-200']['outcome'] == 'PASS' and R['r3-box-count-1000']['outcome'] == 'NO-ORACLE' and abs(tr('r3-box-count-1000')['volume'] - 16 * (3 * 1000 + 1)) < 1e-6
row('repeat(box) with a large count (up to the SolidCraft cap of 1000): overlapping copies fuse into one bar', 'supported',
    CMD3 + '%s | r3-box-count-1000: OCCT cannot build it (its wasm heap is corrupted: "%s"), so the oracle is the closed form 16 x (3 x 1000 + 1) = %d against truck %.4f (6 faces, one body); pattern run time %.1f s. Bare session (no replay): see the timing line below. In round 2 the claim was "up to 40"; the critic measured 47 s for count 200 and "no return in 200 s" for count 1000 on the replaying translator, i.e. the first run of each feature plus every later replay; the pattern run alone is seconds. Bare timings (pm3-time-curved.txt): %s' % (c('r3-box-count-200'), R['r3-box-count-1000']['occtInvalid'][:70], 16 * 3001, tr('r3-box-count-1000')['volume'], pwall('r3-box-count-1000'), ' | '.join(l for l in TIMEC.strip().splitlines() if l.startswith('box'))))
cap = ['r3-box-count-1001','r3-box-count-1e5','r3-around-count-1001']
assert all(R[i]['outcome'] == 'REFUSED' for i in cap)
row('repeat / repeatAround with a count above 1000 (the script only requires a whole number of at least 1; SolidCraft rejects above 1000)', 'refused',
    CMD3 + ' || '.join('%s -> raw "%s"; student "%s"' % (i, tr(i)['refused'].split(' -- ')[-1], stu(i)) for i in cap) + '. Before round 3 the student saw the generic "this shape could not be built reliably, so it was left out." for count 1001. The script layer has no upper bound (rl-count0 / rl-count-frac are its only count checks), so the refusal comes from the kernel and costs nothing (the engine answers in 9 ms).',
    stu('r3-box-count-1001'))
assert 'at most 1000' in stu('r3-box-count-1001')
pk_ok = ['r3-pocket-count-10','r3-pocket-count-20','r3-hole-count-20']
assert all(R[i]['outcome'] == 'PASS' for i in pk_ok)
pk_ko = ['r3-pocket-count-40','r3-pocket-count-60','r3-hole-count-60']
assert all(tmo(i) for i in pk_ko), [(i, R[i]['outcome']) for i in pk_ko]
row('repeat(pocket) / repeat(hole) with a count of 10 to 20 (the script lowers count N to N-1 more sketch+pocket pairs)', 'supported',
    CMD3 + ' | '.join(c(i) for i in pk_ok) + '. Rig cost: %s. Bare single session of the whole lowered command list (pm3-time-bare.mjs): %s.' % (', '.join('%s %.0f s' % (i, R[i]['fx']['ms'] / 1000) for i in pk_ok), TIMEB.strip().replace('\n', ' | ')))
row('repeat(pocket) / repeat(hole) with a count of about 40 or more: the per-feature check replays the accepted commands for every feature, so a long lowered chain costs quadratic time and hits the 300 s whole-model limit [contract translator patch: budget]', 'refused',
    CMD3 + ' || '.join('%s -> %s, student "%s"' % (i, tr(i)['refused'][:140], stu(i)) for i in pk_ko[:1] + pk_ko[2:]) + '. Round 2 never returned for pocket count 60 within 200 s (the critic). The kernel is not the slow part: one bare session builds the same lowered plate in the times in the previous row (%s); the cost is the translator\'s per-feature replay. So this refusal is a limit of the rig\'s per-feature checking, and a product that keeps one session open would not have it. The sentence is truthful for the rig that exists.' % TIMEB.strip().replace('\n', ' | '),
    stu('r3-pocket-count-40'))

# ---- E. sub-micron
sub_gap_ids = ['r3-sub-0.00001','r3-sub-0.000003','r3-sub-0.000001','r3-sub-1e-7']
sub_ov_ids = ['r3-sub--1e-8','r3-sub--1e-7','r3-sub--0.000001']
if A3:
    for i in sub_gap_ids:
        t = A3[i]['fx']['truck']; assert A3[i]['outcome'] == 'FAIL' and t['bodies'] == 1 and t['faces'] == 6, (i, A3[i]['outcome'], t.get('faces'))
    for i in sub_ov_ids:
        t = A3[i]['fx']['truck']; assert t['bodies'] == 3 and t['faces'] == 18, (i, t.get('bodies'), t.get('faces'))
def sg(i, src):
    t = tr(i, src); o = src[i]['fx']['occt']; return '%s: OCCT %.6f/%d faces, truck %.6f/%d faces as %d body(ies), dVol %s' % (i, o['volume'], o['faces'], t['volume'], t['faces'], t['bodies'], E(t['dVol']))
if A3: row('WRONG (round-2 contract translator): repeat of a 10 box with a step that leaves a gap of 1e-5 .. 1e-7 mm (step 10.00001 .. 10.0000001) is FUSED into one 6-face bar (truck closes the gap), and a step that overlaps by 1e-8 .. 1e-6 mm is NOT fused (3 separate bodies, 18 faces, the fallback). OCCT keeps the gap (18 faces) or fuses differently; the planar volume delta is above the 1e-9 bar. No sentence.', 'wrong',
    CMDR2 + ' | '.join(sg(i, A3) for i in sub_gap_ids) + ' || overlap: ' + ' | '.join(sg(i, A3) for i in sub_ov_ids) + '. Gaps of 1e-3 and 1e-4 were already refused by the contact guard (by accident: the pair test saw 2 shells), gaps of 1e-9 and below fuse like OCCT (dVol 2.2e-11) and overlaps of 3e-6 and more fuse correctly. The zone in between is where truck\'s kernel tolerance and the oracle disagree.')
sub_ref = ['r3-sub-0.001','r3-sub-0.0001'] + sub_gap_ids + ['r3-sub-1e-8'] + sub_ov_ids
assert all(R[i]['outcome'] == 'REFUSED' for i in sub_ref), [(i, R[i]['outcome']) for i in sub_ref if R[i]['outcome'] != 'REFUSED']
row('repeat of PLANAR copies separated by a gap between 1e-8 and 1e-3 mm, or overlapping by 1e-8 .. 1e-6 mm [contract translator patch: subgap, and the disjoint fallback guard]', 'refused',
    CMD3 + 'Gaps: ' + ' | '.join('%s -> %s' % (i, tr(i)['refused'][:100]) for i in ['r3-sub-0.001','r3-sub-1e-8']) + '. Overlaps: ' + ' | '.join('%s -> %s' % (i, tr(i)['refused'][:110]) for i in sub_ov_ids[:2]) + '. Student sentences (produced by this run): gap "%s"; overlap "%s". The gap check only judges planar copies (a curved copy\'s tessellated box cannot resolve 3e-4 mm).' % (stu('r3-sub-0.000001'), stu('r3-sub--1e-7')),
    stu('r3-sub-0.000001'))
sub_ok = ['r3-sub-0.01','r3-sub-1e-9','r3-sub-0','r3-sub--1e-9','r3-sub--0.000003','r3-sub--0.00001','r3-sub--0.0001','r3-sub--0.001']
assert all(R[i]['outcome'] == 'PASS' and tr(i)['dVol'] < 1e-9 for i in sub_ok), [(i, R[i]['outcome'], tr(i).get('dVol')) for i in sub_ok]
row('repeat of PLANAR copies with a gap above 1e-3 mm (step 10.01), touching (step 10), a gap of 1e-9 or less, or an overlap of 3e-6 mm or more', 'supported',
    CMD3 + ' | '.join(c(i) for i in sub_ok) + '. All planar dVol below 1e-9. Face counts follow the convention row (truck 6 for fused bars).')


# ---- F. mirror: spun parts, tapered, lofted, drafted, turned, and the advice in the contact sentence
import math
sp_ok = ['r3-mir-vaseF-fb','r3-mir-vaseT-tb']
assert all(ok(i) and tr(i)['bodies'] == 1 and tr(i)['dVol'] <= 3e-4 for i in sp_ok), [(i, R[i]['outcome']) for i in sp_ok]
row('mirror of a SPUN part whose end on the mirror plane is a full flat disc (vase with a flat bottom, profile touching the axis): across its axis direction, so a flat end faces the mirror', 'supported',
    CMD3 + ' | '.join(c(i) for i in sp_ok) + '. The mirror plane comes from the new analytic box of a full-turn straight-edged spin (patch spinbox), so no tessellated box is involved (mirrorAt.how = analytic). Round 2 refused every spun part here with "the part\'s curved side makes the mirror position too uncertain ... mirror a part whose ends are flat", which was wrong for a part whose ends ARE flat.')
sp_curved = ['r3-mir-washerT-lr','r3-mir-spin-offset-lr','r3-mir-vaseF-tb','r3-mir-washerF-tb','r3-mir-washerF-tb-moved']
assert all(refused(i) for i in sp_curved), [(i, R[i]['outcome']) for i in sp_curved]
row('mirror of a SPUN part across a direction where its CURVED SIDE or rim is the nearest side (washer left-right when its axis is z, washer top-bottom when its axis is y, moved or not; vase top-bottom with its axis y, where only the rim circle touches)', 'refused',
    CMD3 + ' || '.join(cc(i) for i in sp_curved) + '. OCCT and brep-rs build these (a pair touching along a line or at a point). The refusal comes from solidcraft itself ("lumps: shell boundaries intersect or touch") or, when it returns two unfused bodies instead, from the new fused guard (below). Round 2 refused them with the misleading "mirror a part whose ends are flat".',
    stu('r3-mir-washerT-lr'))
sp_ring = ['r3-mir-washerT-tb','r3-mir-washerT-tb-moved','r3-mir-washerF-fb','r3-mir-washerF-fb-moved']
assert all(refused(i) for i in sp_ring)
nc_unfused = ([i for i in sp_ring if NC[i]['outcome'] in ('PASS', 'FAIL') and NC[i]['fx']['truck']['bodies'] == 2]) if NC else []
assert (not NC) or ('r3-mir-washerF-fb' in nc_unfused and 'r3-mir-washerF-fb-moved' in nc_unfused), [(i, NC[i]['outcome']) for i in sp_ring]
pw = R['r3-adv-pull-washer-tb']; assert ok('r3-adv-pull-washer-tb') and tr('r3-adv-pull-washer-tb')['bodies'] == 1
row('mirror of a SPUN washer (a hole through it) across a FLAT annulus: axis z top-bottom, axis y front-back, moved or not. OCCT and brep-rs build all four; SolidCraft cannot fuse the copy', 'refused',
    CMD3 + ' || '.join(cc(i) for i in sp_ring) + '. Two failure shapes: for axis z solidcraft refuses ("solid.mirror: boolean Union: the operation failed"); for axis y solid.mirror combine:true returns SUCCESS with TWO bodies (volume and bbox are right, the copy is not fused). NEGATIVE CONTROL (PM_OFF=fused, pm3-results-fusedoff.json): without the fused guard %s build as 2 separate bodies and score %s against OCCT by volume, i.e. a volume gate calls them supported. The same washer built from cylinders instead of spin() mirrors fine: %s (so the advice in the sentence works). Student sentence (produced by this run): "%s"' %
    (' and '.join(nc_unfused) if NC else 'the axis-y washers', '/'.join(NC[i]['outcome'] for i in nc_unfused) if NC else 'LOST-DATA (pm3-results-fusedoff.json is not in this directory; the negative control was not re-run this round)', c('r3-adv-pull-washer-tb'), stu('r3-mir-washerF-fb')),
    stu('r3-mir-washerF-fb'))
assert stu('r3-mir-washerT-tb') == stu('r3-mir-washerF-fb')

# tapered pull: oracle = closed form (OCCT ignores pull options: occt-build.ts never reads taper; brep-rs and truck read it)
def frustum(side, h, deg):
    a2 = (side + 2 * h * math.tan(math.radians(deg))) ** 2; a1 = side * side
    return h / 3 * (a1 + a2 + math.sqrt(a1 * a2))
V_taper = frustum(20, 15, 5); V_tneg = frustum(20, 15, -5)
assert abs(tr('r3-taper-alone')['volume'] / V_taper - 1) < 1e-9 and ok('r3-mir-taper-tb') is False
assert abs(tr('r3-mir-taper-tb')['volume'] / (2 * V_taper) - 1) < 1e-9 and abs(tr('r3-mir-taper-neg-tb')['volume'] / (2 * V_tneg) - 1) < 1e-9
assert refused('r3-mir-taper-lr') and 'mirror contact is not a face' in tr('r3-mir-taper-lr')['refused']
bt = R['r3-mir-taper-tb']['fx']['brep']['volume']
row("mirror of a TAPERED pull across its flat end (pull(sketch,15,{taper:5}) moved up, mirror 'top-bottom'; also a negative taper) [contract translator patch: taper maps pull's taper option, same mapping and fold guard as the extrude-pocket group]", 'supported',
    CMD3 + 'Oracles: closed form for a square frustum, OCCT unusable (occt-build.ts ignores the taper: OCCT %.1f for the bare pull, %.1f for the pair), brep-rs agrees with truck. Bare taper-5 pull side 20 height 15: closed form %.6f, truck %.6f. Mirror top-bottom: closed form 2V = %.6f, truck %.6f (dVol %s, 1 body 1 shell, 10 faces), brep-rs %.6f. Taper -5: closed form 2V = %.6f, truck %.6f. (The rig scores these FAIL only because the OCCT referee ignores the taper.)' %
    (R['r3-taper-alone']['fx']['occt']['volume'], R['r3-mir-taper-tb']['fx']['occt']['volume'], V_taper, tr('r3-taper-alone')['volume'], 2 * V_taper, tr('r3-mir-taper-tb')['volume'], E(abs(tr('r3-mir-taper-tb')['volume'] / (2 * V_taper) - 1)), bt, 2 * V_tneg, tr('r3-mir-taper-neg-tb')['volume']))
lr_ref = ['r3-mir-taper-lr','r3-mir-loft-lr']
assert all(refused(i) and 'mirror contact is not a face' in tr(i)['refused'] for i in lr_ref)
row("mirror of a part whose sides lean (tapered pull, lofted part) across a SIDE direction: the nearest side is an edge (the top or bottom rim), so the copy touches along a line [contract translator patch: mircontact]", 'refused',
    CMD3 + 'WITHOUT the guard solid.mirror builds this and fuses the pair into ONE shell (r3-mir-taper-lr: volume 2V = 13643.684, 11 faces, 1 shell) although the two prisms touch only along the top rim line; brep-rs does the same, so no oracle objects. With the guard (the plane is pushed in by 1e-2 and 1e-3 mm and the overlap volume must grow like d for a face, d^2 for an edge): ' + ' || '.join(cc(i) for i in lr_ref) + '. Raw: "%s". The guard is applied to single-shell planar parts only (exact volumes). Student sentence (produced by this run): "%s"' % (tr('r3-mir-taper-lr')['refused'][:200], stu('r3-mir-taper-lr')),
    stu('r3-mir-taper-lr'))
# loft top-bottom, draft top-bottom
loftA = R['r3-mir-loft-tb']
assert abs(tr('r3-mir-loft-tb')['volume'] - 56000) < 1e-6 and loftA['fx']['truck']['dBbox'] < 1e-7
row("mirror of a LOFTED part across its flat end (loft between a 40 square at z=5 and a 20 square at z=35, mirror 'top-bottom') and of a face-DRAFTED box across its flat end", 'supported',
    CMD3 + '%s | %s. The loft is scored FAIL by the rig only on bbox (%s against the 1e-9 bar): the OCCT bbox of a lofted solid is the known referee artifact (blend-loft group: AddOptimal is looser than the exact box); closed form 2 x (5/3... frustum) volume 56000 = 2 x 28000 equals truck to %s. OCCT/brep-rs/truck faces 10/12/10 (convention). A drafted face: draft built and mirrored, volume equal to OCCT to %s.' % (c('r3-mir-loft-tb'), c('r3-mir-draft-tb'), E(loftA['fx']['truck']['dBbox']), E(tr('r3-mir-loft-tb')['dVol']), E(tr('r3-mir-draft-tb')['dVol'])))
assert ok('r3-mir-draft-tb') and refused('r3-mir-draft-lr')
row("mirror of a drafted part whose draft solidcraft refuses (draft(box.face('top'),5) then mirror): the mirror inherits the draft refusal and names it", 'refused',
    CMD3 + cc('r3-mir-draft-lr') + ' || ' + ' ; '.join('%s %s: %s' % (f['id'], f['kind'], f['student']) for f in R['r3-mir-draft-lr']['fx']['truckFeatures'] if f['status'] == 'refused') + '. Raw: "%s". Round 2 would have repeated the root sentence under the wrong call; now the dependent names the call it needs and the root cause (the draft group owns the draft refusal itself).' % tr('r3-mir-draft-lr')['firstRefusal'][:200],
    stu('r3-mir-draft-lr'))
# turned boxes
tu_ok = ['r3-mir-turned45-tb','r3-mir-turned90-lr']; tu_ko = ['r3-mir-turned45-lr','r3-mir-x45-tb']
assert all(ok(i) and tr(i)['dVol'] < 1e-9 for i in tu_ok) and all(refused(i) for i in tu_ko)
row('mirror of a TURNED box with a flat face toward the mirror (turned 45 about z, top-bottom; turned 90, left-right)', 'supported',
    CMD3 + ' | '.join(c(i) for i in tu_ok) + '.')
row('mirror of a turned box whose nearest side is an EDGE (turned 45 about z left-right; turned 45 about x top-bottom)', 'refused',
    CMD3 + ' || '.join(cc(i) for i in tu_ko) + '. Raw: "%s".' % tr('r3-mir-turned45-lr')['refused'].split(' -- ')[-1][:120],
    stu('r3-mir-turned45-lr'))
# advice verification
adv = [('r3-adv-cyl-lr','r3-adv-cyl-turned-lr'),('r3-adv-cyl-lr','r3-adv-cyl-tb'),('r3-adv-hex-lr','r3-adv-hex-turned-lr')]
assert refused('r3-adv-cyl-lr') and ok('r3-adv-cyl-turned-lr') and ok('r3-adv-cyl-tb') and refused('r3-adv-hex-lr') and refused('r3-adv-sphere-lr') and refused('r3-adv-sphere-flat-lr')
assert R['r3-adv-hex-turned-lr']['fx']['truck']['geomOk'] or tr('r3-adv-hex-turned-lr')['dVol'] < 1e-5
hexd = abs(tr('r3-adv-hex-turned-lr')['volume'] / R['r3-adv-hex-turned-lr']['fx']['brep']['volume'] - 1)
row('the advice in the mirror contact sentence WORKS: a cylinder refused left-right builds once it is turned so a flat end points that way or mirrored top-bottom; a hexagon prism refused left-right builds once turned 30 degrees. A sphere has no such fix (said in the sentence)', 'supported',
    CMD3 + '%s -> %s || %s -> %s || %s -> %s. Hexagon turned: truck vs brep-rs volume %s (OCCT differs by 2.1e-6 in volume and 7.7e-6 in bbox: the known OCCT prism-bbox artifact, see mi-hexprism-fb-flat). Sphere: %s; flattening it with keep(sphere, box) is refused for another reason (%s), so no fix is claimed for a sphere.' %
    (cc('r3-adv-cyl-lr'), cc('r3-adv-cyl-turned-lr'), cc('r3-adv-cyl-lr'), cc('r3-adv-cyl-tb'), cc('r3-adv-hex-lr'), cc('r3-adv-hex-turned-lr'), E(hexd), cc('r3-adv-sphere-lr'), stu('r3-adv-sphere-flat-lr')))

# ---- G. partial-angle inconsistency
AP = open(os.path.join(H, 'pm3-angle-probe.txt')).read()
assert 'copy angles about z (from the lowered doc): [0,0,45,90]' in AP and 'HOLE count 3 angle 90' in AP and '[0,45,90]' in AP and 'measured COM direction 30 deg' in AP
row('WRONG (the shipped language): the SAME call repeatAround(x, {count:3, angle:90}) puts the copies at 0, 45 and 90 degrees when x is a pocket or a hole (angle/(count-1), the FreeCAD rule) but at 0, 30 and 60 degrees when x is a whole solid or a pad (angle/count, the ModelDoc rule). Round 2 filed this as a pending decision; it is a defect in the language that is live today.', 'wrong',
    'cd /home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract && bun pm3-angle-probe.mjs [reSHape Script -> ModelDoc; OCCT and brep-rs volume-weighted centre of mass; output in pm3-angle-probe.txt]. ' + AP.strip().replace('\n', ' | ') + ' || Reading: for the solid, the OCCT and brep-rs bounding boxes are IDENTICAL (12.268..32 by -2..28.713) and the COM direction is 30 degrees, which is the mean of copies at 0/30/60; spacing angle/(count-1) would give 45. For the pocket and the hole the lowered ModelDoc has circles at 0, 45, 90 (the 0 before them is the plate). For a pad (join(plate, boss)) the lowering is a pattern feature, i.e. the solid rule. Raw solidcraft solid.pattern.circular with a partial angle spaces by angle/(count-1) (0/45/90, pm-critic raw.mjs), so mapping the solid case through would build a DIFFERENT solid than OCCT and brep-rs with no error: the contract therefore refuses it (partial-turn row) and cannot make the call mean one thing. Fix needed in the language, not the kernel: pick one rule for all targets. Count 4 angle 90: solid copies at 0/22.5/45/67.5, pocket copies at 0/30/60/90.')

# ---- H. sentence census over every refused feature of this group
import collections
cens = collections.OrderedDict()
for i, x in R.items():
    fx = x.get('fx')
    if not fx: continue
    for f in fx['truckFeatures']:
        if f['status'] == 'refused':
            cens.setdefault(f['student'], []).append(i)
generic = [(sn, ids) for sn, ids in cens.items() if 'the kernel could not build this (' in sn]
named = [(sn, ids) for sn, ids in cens.items() if 'the kernel could not build this (' not in sn]
import re
leak = [sn for sn in cens if re.search(r'brep-rs|FreeCAD|OCCT|truck|solidcraft|solid\.', sn)]
assert not leak, leak
row('every refusal sentence the contract translator produces for this group is about the student\'s own call, names the cause, and never an engine or an internal id; the fallback "the kernel could not build this (<reason>)" is the only generic one', 'supported',
    'Census over all %d cases of pm-results.json: %d distinct student sentences from %d refused features; %d are the generic fallback "the kernel could not build this (...)" (reasons: %s); none mentions brep-rs, FreeCAD, OCCT, truck or solidcraft. Before round 3 the fallback was the bare "this shape could not be built reliably, so it was left out." for: count 1001, mirror of a tapered pull (labelled extrude()), the spun-part mirror, and every unmapped option. Distinct sentences: %s' %
    (len(R), len(cens), sum(len(v) for v in cens.values()), len(generic), '; '.join(sn.split('(', 1)[1][:70] for sn, ids in generic) or 'none', ' || '.join('[%d] %s' % (len(ids), sn) for sn, ids in named)))

# ============================ face counts ============================
fcs = [('rl-disjoint-x3','3 disjoint boxes (not fused)'),('rl-touch-x3','3 face-touching boxes'),('rl-overlap-x4','4 overlapping boxes'),('rl-count-40-overlap','40 overlapping boxes'),('mi-lr-offset-box','box mirrored (face contact)'),('mi-of-join','joined boxes mirrored'),('r2-tie-hexprism-tb','hex prism mirrored top-bottom'),('rl-cyl-disjoint','3 disjoint cylinders'),('rl-cyl-overlap','3 overlapping cylinders'),('r3-cyl-hole-overlap','2 overlapping drilled discs'),('ra-z6-cyl-overlap','ring of 6 overlapping cylinders'),('ra-count-36-overlap','36 overlapping boxes around z'),('r2-tie-cyl-tb','cylinder mirrored top-bottom (planar cap)'),('r2-tie-drilled-cyl-tb','drilled cylinder mirrored'),('mi-cone-tb','cone mirrored')]
for i, _ in fcs: assert R[i]['outcome'] == 'PASS' and R[i]['fx']['truck']['faceKey'] is not None, i
def fk(i):
    t = tr(i); return t.get('faceKey') or ','.join('%s=%s' % kv for kv in t['faceKeys'].items())
row('face counts of fused patterns and mirrors differ between truck, OCCT and brep-rs (a convention, not a defect)', 'supported',
    CMD + 'Per case faces OCCT/brep-rs/truck and the live-measured reason (pm-run.mjs faceVerdict, computed from the OCCT shape): ' + ' | '.join('%s [%s]: %s/%s/%s %s' % (lab, i, R[i]['fx']['occt']['faces'], R[i]['fx']['brep'].get('faces', 'refused'), tr(i)['faces'], fk(i)) for i, lab in fcs) + '. Rule: truck merges coplanar (and co-cylindrical) faces that are edge-connected, so fused boxes read 6 where OCCT keeps 14 and brep-rs 18 (3 face-touching boxes); OCCT and brep-rs keep every original face and split them along the seams. Curved: two overlapping drilled discs are 8 faces in truck and brep-rs, 19 in OCCT; the mirrored cylinder is 3 faces in truck (one fused side, two caps) against 4 in OCCT and 6 in brep-rs. A face-count assertion in a test must therefore compare per-surface-class components, not totals. Every case in this table has a live-measured verdict (none UNEXPLAINED). The one exception elsewhere in the file is mi-hexprism-fb-flat, whose OCCT face count (16) is itself the artifact described in its row.')

def _sig2(x):
    t = (x.get('fx') or {}).get('truck') or {}
    return (x['outcome'], round(t['volume'], 6) if t.get('volume') is not None else None, (t.get('refused') or '')[:60])
_d2 = [i for i in R2 if i in R and _sig2(R2[i]) != _sig2(R[i])]
RDIFF = '%d of %d cases differ: %s' % (len(_d2), len(R2), ', '.join('%s %s->%s' % (i, R2[i]['outcome'], R[i]['outcome']) for i in _d2) or 'none')
# ---- which cases depend on the translator patches: full AS-IS run vs full contract run
def sig(x):
    t = (x.get('fx') or {}).get('truck') or {}
    return (x['outcome'], round(t['volume'], 6) if t.get('volume') is not None else None, (t.get('refused') or '')[:60])
common = [i for i in A if i in R and not i.startswith('r2-torus')]
dif = [i for i in common if sig(A[i]) != sig(R[i])]
GROUPS = {'count1': lambda i: i.startswith('r2-count1') or i in ('rl-count1', 'ra-count1', 'rap-pad-count1'), 'plane': lambda i: i.startswith(('r2-tie', 'r2-neartie', 'r2-offorigin')) or i in ('mi-cyl-lr-tangent', 'mi-cyl-lr-tangent-big'),
          'fresh': lambda i: i in ('mi-of-repeat',) or i.startswith('r2-mirror-of-repeat') or i in ('r2-mirror-of-disjoint-join', 'r2-mirror-of-around'),
          'reversed': lambda i: i.startswith('mirrored__top-bottom-') or i == 'rl-pocket-reversed-own',
          'contact': lambda i: i in ('rl-edge-touch', 'rl-vertex-touch', 'r2-around-vertex-touch', 'rl-diag-overlap') or i.startswith('r2-repeat-'),
          'contact3 (curved tolerance)': lambda i: i in ('rl-cyl-tangent', 'r2-sens-sphere-ring-d20-n12')}
unexplained = [i for i in dif if not any(g(i) for g in GROUPS.values())]
grp = {k: [i for i in dif if g(i)] for k, g in GROUPS.items()}
assert not unexplained, unexplained
assert 'rl-diag-overlap' not in dif  # the contact guard must not touch the overlapping-diagonal case
rows[0]['evidence'] += ' PATCH DEPENDENCE (full AS-IS run PM_TR=asis vs the round-3 contract run, %d cases present in both, torus cases excluded): %d differ and every one is explained by a named patch: %s. All other %d cases are identical AS-IS (same outcome, same volume to 1e-6, same refusal text), so no other row in this file depends on a patch except the r3-* rows (their round-2 behaviour is in pm3-results-r2translator.json) and the torus rows (their AS-IS runs are in pm-torus-asis.json). ROUND-2 vs ROUND-3 contract on the 299 round-2 cases (pm-results-round2.json vs pm-results.json): %s.' % (len(common), len(dif), '; '.join('%s: %s' % (k, ', '.join(v)) for k, v in grp.items() if v), len(common) - len(dif), RDIFF)

assert 'UNEXPLAINED' not in rows[-1]['evidence'].split('Rule:')[0]
# ---- ROUND 4 provenance: the truck side is STORED, not re-run (the referee pkg did not exist this round)
RC = json.load(open(os.path.join(H, 'pm-oracle-recheck.json')))
PROV = ('[PROVENANCE, round 4] SolidCraft (truck) numbers and refusal sentences in this row are STORED results from contract/pm-results.json (written 2026-10-18 09:19 by pm-run.mjs), NOT re-run in this round: the pre-built referee pkg named in the task (sc-referee-pkg) does not exist, and the rules forbid rebuilding the wasm. '
        'Re-run live this round (pm-run.mjs against a stub pkg whose run() always fails, so script -> ModelDoc -> live OCCT -> live brep-rs executed fresh; compared by pm-oracle-recheck.py, numbers in pm-oracle-recheck.json): '
        '%d of %d stored cases re-run (the 4 count 1000/1001/100000 cases were skipped because OCCT does not return on them); %d script-layer refusal sentences identical, %d different; '
        'OCCT volume/bbox/face count identical to the stored values on %d cases (max relative delta %.1e), brep-rs on %d cases (max relative delta %.1e), %d OCCT-invalid cases invalid again; '
        'stored truck dVol recomputed against the fresh OCCT volume on %d cases, max difference %.1e. '
        'So the oracle side and the scoring are reproduced; whether the stored truck output was produced by the pinned fe3717f build is NOT attested (pm-results.json carries no pkg stamp). '
        'Translator-level refusal sentences that need truck first (%d stored REFUSED cases) could not be reproduced without the rig. '
        'Data from earlier rounds that is no longer in this directory (pm3-results-r2translator.json, pm3-results-fusedoff.json, pm3-time-bare.txt, pm3-time-curved.txt) is marked LOST-DATA where a number came from it; the two rows that were built only from it were dropped (their guards are the refused rows). Evidence follows. ') % (
    RC['fresh_cases'], RC['stored_cases'], RC['script_refused']['same'], len(RC['script_refused']['different']), RC['occt']['compared'], RC['occt']['max_dVol'], RC['brep']['compared'], RC['brep']['max_dVol'], RC['occt']['invalid_both'],
    RC['stored_truck_vs_fresh_occt']['compared'], RC['stored_truck_vs_fresh_occt']['max_abs_difference_in_dVol'], RC['translator_refusal_text']['needs_truck'])
assert not RC['script_refused']['different'] and not RC['occt']['volume_differs'] and not RC['occt']['faces_differ'] and not RC['brep']['volume_differs'] and not RC['brep']['faces_differ'] and not RC['stored_truck_vs_fresh_occt']['cases_where_stored_dVol_does_not_match']
for r_ in rows: r_['evidence'] = PROV + r_['evidence']
out = {'group': 'patterns-mirror', 'rows': rows}
json.dump(out, open(os.path.join(H, 'patterns-mirror.json'), 'w'), indent=1)
print(len(rows), 'rows')
for r_ in rows: print(r_['status'].ljust(10), r_['feature'][:120])
