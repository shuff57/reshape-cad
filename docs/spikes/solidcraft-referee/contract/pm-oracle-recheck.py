# Round 4. The solidcraft referee pkg did not exist this round, so the truck side of pm-results.json could not be re-run.
# This compares everything that CAN be re-run without truck: pm-run.mjs was run against a stub pkg whose run() always fails
# (so script -> ModelDoc -> live OCCT -> live brep-rs all executed fresh), and the fresh numbers are compared with the stored pm-results.json.
#   python3 pm-oracle-recheck.py <fresh pm-results.json> [--write]   -> writes pm-oracle-recheck.json next to this file
import json, os, sys
H = os.path.dirname(os.path.abspath(__file__))
fresh = {x['id']: x for x in json.load(open(sys.argv[1]))}
stored = {x['id']: x for x in json.load(open(os.path.join(H, 'pm-results.json')))}
rel = lambda a, b: abs(a - b) / max(abs(b), 1.0)
out = {'fresh_cases': len(fresh), 'stored_cases': len(stored), 'not_rerun': sorted(set(stored) - set(fresh)), 'script_refused': {'same': 0, 'different': []},
       'occt': {'compared': 0, 'max_dVol': 0.0, 'max_dBbox': 0.0, 'faces_differ': [], 'volume_differs': [], 'invalid_both': 0, 'invalid_one_side': []},
       'brep': {'compared': 0, 'max_dVol': 0.0, 'max_dBbox': 0.0, 'faces_differ': [], 'volume_differs': [], 'refusal_differs': []},
       'stored_truck_vs_fresh_occt': {'compared': 0, 'max_abs_difference_in_dVol': 0.0, 'cases_where_stored_dVol_does_not_match': []},
       'translator_refusal_text': {'stored_refused': 0, 'reproduced_verbatim_without_truck': 0, 'needs_truck': 0, 'different_text': []}}
for i, s in stored.items():
    f = fresh.get(i)
    if f is None: continue
    if s['outcome'] == 'SCRIPT-REFUSED' or f['outcome'] == 'SCRIPT-REFUSED':
        if s['outcome'] == f['outcome'] and s.get('sentence') == f.get('sentence'): out['script_refused']['same'] += 1
        else: out['script_refused']['different'].append(i)
        continue
    sx, fx = s.get('fx') or {}, f.get('fx') or {}
    so, fo = sx.get('occt'), fx.get('occt')
    sbad = bool(s.get('occtInvalid')) or not so or not isinstance(so.get('volume'), (int, float)) or so['volume'] != so['volume']
    fbad = bool(f.get('occtInvalid')) or not fo or not isinstance(fo.get('volume'), (int, float)) or fo['volume'] != fo['volume']
    if sbad and fbad: out['occt']['invalid_both'] += 1
    elif sbad != fbad: out['occt']['invalid_one_side'].append(i)
    else:
        o = out['occt']; o['compared'] += 1
        dv = rel(fo['volume'], so['volume']); db = max(rel(a, b) for a, b in zip(fo['bbox'], so['bbox']))
        o['max_dVol'] = max(o['max_dVol'], dv); o['max_dBbox'] = max(o['max_dBbox'], db)
        if dv > 1e-9: o['volume_differs'].append((i, so['volume'], fo['volume']))
        if fo['faces'] != so['faces']: o['faces_differ'].append((i, so['faces'], fo['faces']))
    st = sx.get('truck') or {}
    if not fbad and isinstance(st.get('volume'), (int, float)) and isinstance(st.get('dVol'), (int, float)):
        d = rel(st['volume'], fo['volume']); k = out['stored_truck_vs_fresh_occt']; k['compared'] += 1
        k['max_abs_difference_in_dVol'] = max(k['max_abs_difference_in_dVol'], abs(d - st['dVol']))
        if abs(d - st['dVol']) > 1e-9: k['cases_where_stored_dVol_does_not_match'].append((i, st['dVol'], d))
    sb, fb = sx.get('brep') or {}, fx.get('brep') or {}
    if 'volume' in sb and 'volume' in fb:
        b = out['brep']; b['compared'] += 1
        dv = rel(fb['volume'], sb['volume']); db = max(rel(a, c) for a, c in zip(fb['bbox'], sb['bbox']))
        b['max_dVol'] = max(b['max_dVol'], dv); b['max_dBbox'] = max(b['max_dBbox'], db)
        if dv > 1e-9: b['volume_differs'].append((i, sb['volume'], fb['volume']))
        if fb.get('faces') != sb.get('faces'): b['faces_differ'].append((i, sb.get('faces'), fb.get('faces')))
    elif ('refused' in sb) != ('refused' in fb) or ('refused' in sb and sb['refused'] != fb['refused']):
        out['brep']['refusal_differs'].append(i)
    if s['outcome'] == 'REFUSED':
        t = out['translator_refusal_text']; t['stored_refused'] += 1
        ss = (sx.get('truck') or {}).get('student') or (sx.get('truck') or {}).get('firstStudent')
        fs = (fx.get('truck') or {}).get('student') or (fx.get('truck') or {}).get('firstStudent')
        if ss and fs and ss == fs: t['reproduced_verbatim_without_truck'] += 1
        elif ss and (not fs or 'NO SOLIDCRAFT RIG' in json.dumps(fx.get('truck') or {})): t['needs_truck'] += 1
        else: t['different_text'].append(i)
if '--write' in sys.argv: json.dump(out, open(os.path.join(H, 'pm-oracle-recheck.json'), 'w'), indent=1)
print(json.dumps({k: (v if not isinstance(v, dict) else {a: (b if not isinstance(b, list) else b[:12]) for a, b in v.items()}) for k, v in out.items()}, indent=1)[:6000])
