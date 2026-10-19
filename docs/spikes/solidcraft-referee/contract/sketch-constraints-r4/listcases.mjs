const { CASES } = await import('/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/cases.mjs');
CASES.filter((c) => c.geoms && !c.legacy).forEach((c, i) => console.log(i + 1, c.id, c.modes.join('/')));
