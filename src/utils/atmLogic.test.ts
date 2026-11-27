import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type {ErrorCodesDatabase, SchemesDatabase} from '../types/atm';
import {
  buildIndexes,
  extractCodes,
  lookupValue,
  parseDescription,
  searchErrorsByKeyword,
  searchErrorsByKeywordFull,
} from './errorLookup';
import {
  buildSensorIndex,
  filterGalleryByGroup,
  findMatchingSensors,
  findSensor,
  findSensorsInText,
  getExtendedGallery,
  getSensorHintsForError,
  listSensorsByDevice,
  splitTextWithSensors,
} from './sensorLookup';
import {parseGuideMarkdown, searchAllGuides, segmentGuideText} from './guideParser';
import {parseUrlState, serializeUrlState} from './urlState';
import {getNextTheme, parseStoredTheme, resolveTheme} from './theme';
import {
  clampZoom,
  computeFocalScroll,
  computePinchZoom,
  getTouchDistance,
  getTouchMidpoint,
} from './pinchZoom';

const DATA_DIR = path.resolve(process.cwd(), 'public/assets/aistudio');

const errorDb = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'error_codes_9f400606.json'), 'utf-8'),
) as ErrorCodesDatabase;
const errorIndexes = buildIndexes(errorDb);

const schemesDb = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'schemes_26bbeb13.json'), 'utf-8'),
) as SchemesDatabase;
const {index: sensorIndex, minLen: sensorMinLen} = buildSensorIndex(schemesDb);

test('extractCodes normalizes dashes, thousands separators, leading zeros, and limits to 10', () => {
  assert.deepEqual(extractCodes('-1335'), [-1335]);
  assert.deepEqual(extractCodes('−1335'), [-1335]);
  assert.deepEqual(extractCodes('–1335'), [-1335]);
  assert.deepEqual(extractCodes('—1335'), [-1335]);
  assert.deepEqual(extractCodes('- 1335'), [-1335]);
  assert.deepEqual(extractCodes('-1335.'), [-1335]);
  assert.deepEqual(extractCodes('код 1335'), [1335]);
  assert.deepEqual(extractCodes('-1335 -1334'), [-1335, -1334]);
  assert.deepEqual(extractCodes('1335, 1334'), [1335, 1334]);
  assert.deepEqual(extractCodes('1,335'), [1335]);
  assert.deepEqual(extractCodes('008'), [8]);
  assert.deepEqual(extractCodes('abc-12'), []);
  assert.deepEqual(extractCodes('привет'), []);
  assert.equal(
    extractCodes('1 2 3 4 5 6 7 8 9 10 11 12').length,
    10,
  );
});

test('lookupValue handles leading zeros, dual GRG sign lookup, sign-flip marking, and mode filtering', () => {
  const keys = (val: number, mode: 'all' | 'grg' | 'ccdm' | 'cmd_v4' = 'all') =>
    lookupValue(val, errorDb, errorIndexes, mode).map((m) => [m.category, m.key, m.signMatches]);

  assert.deepEqual(keys(1323).slice(0, 2), [
    ['grg', '1323', true],
    ['grg', '-1323', false],
  ]);

  assert.deepEqual(
    keys(-1323).filter(([cat]) => cat === 'grg'),
    [['grg', '-1323', true]],
  );

  assert.deepEqual(keys(8)[0], ['grg', '-8', false]);
  assert.ok(
    keys(8).some(([cat, key, ok]) => cat === 'cmd_v4' && key === '08' && ok === true),
  );
  assert.ok(
    keys(8).some(([cat, key, ok]) => cat === 'ccdm' && key === '08' && ok === true),
  );

  assert.deepEqual(keys(8, 'ccdm'), [['ccdm', '08', true]]);
  assert.deepEqual(keys(8, 'cmd_v4'), [['cmd_v4', '08', true]]);
  assert.deepEqual(keys(-1335, 'ccdm'), []);
  assert.deepEqual(keys(-1335, 'grg'), [['grg', '-1335', true]]);
});

test('parseDescription extracts category, description, and recommendations cleanly', () => {
  const parsed = parseDescription(
    'Категория: Hardware\nОписание: Jam at SF17\nРекомендации: Check sensor SF17\nClean rollers',
  );
  assert.equal(parsed.category, 'Hardware');
  assert.equal(parsed.description, 'Jam at SF17');
  assert.equal(parsed.recommendations, 'Check sensor SF17\nClean rollers');
});

test('searchErrorsByKeyword and searchErrorsByKeywordFull find relevant descriptions with total count', () => {
  const hits = searchErrorsByKeyword('shutter', errorDb, 'grg', 10);
  assert.ok(hits.length > 0 && hits.length <= 10);
  assert.ok(hits.every((h) => h.category === 'grg'));

  const full = searchErrorsByKeywordFull('shutter', errorDb, 'all', 5);
  assert.equal(full.items.length, 5);
  assert.ok(full.total >= 5);
});

test('sensorLookup finds sensors across devices, Cyrillic lookalikes, aliases, and CRS ranges', () => {
  assert.equal(findSensor('SF01', sensorIndex)[0]?.scheme.device, 'CRM9250N');
  assert.equal(findSensor('VLS12', sensorIndex)[0]?.name, 'VLS12');
  assert.equal(findSensor('vls 12', sensorIndex)[0]?.scheme.device, 'CCDM');
  assert.equal(findSensor('ССЕ1', sensorIndex)[0]?.name, 'CCE1');
  assert.equal(findSensor('РS27', sensorIndex)[0]?.name, 'PS27');
  assert.equal(findSensor('KLS11', sensorIndex)[0]?.name, 'KLS11');
  assert.equal(findSensor('kls1-1', sensorIndex)[0]?.name, 'KLS1_1');

  const vls13 = findSensor('VLS13', sensorIndex);
  assert.equal(vls13.length, 2);
  assert.ok(vls13.every((h) => h.name === 'VSL13'));

  for (const name of ['TUB_PS1a-d', 'TUB_PS1b', 'tub_ps1d', 'TUB_PS1']) {
    const hits = findSensor(name, sensorIndex);
    assert.equal(hits[0]?.name, 'TUB_PS1a-d', name);
  }
  assert.equal(findSensor('IOT_DPS1a', sensorIndex)[0]?.name, 'IOT_DPS1a');
  assert.deepEqual(findSensor('TUB_PS1e', sensorIndex), []);

  const textHits = findSensorsInText('сработал SF01 и pes', sensorIndex, sensorMinLen);
  assert.deepEqual(textHits, ['SF01', 'PES']);
});

test('splitTextWithSensors, findMatchingSensors, and getExtendedGallery work accurately', () => {
  const parts = splitTextWithSensors(
    'Notes over width limit are detectedby withdrawal SF17',
    ['CRM9250N'],
    sensorIndex,
  );
  assert.equal(parts.length, 2);
  assert.equal(parts[0].kind, 'text');
  assert.deepEqual(parts[1], {
    kind: 'sensor',
    value: 'SF17',
    sensorName: 'SF17',
    device: 'CRM9250N',
  });

  const suggestions = findMatchingSensors('SF1', schemesDb, 'grg', 10);
  assert.ok(suggestions.some((s) => s.name === 'SF17'));
  assert.ok(suggestions.length <= 10);

  const allGallery = getExtendedGallery(schemesDb, 'all');
  assert.equal(allGallery.length, Object.keys(schemesDb.images).length);
  assert.ok(allGallery.some((g) => g.image === 'crm_up' && g.markerCount === 48));
});

test('getSensorHintsForError links code 25523 to SF17 on CRM9250N and CCDM 21 to CCDM schemes', () => {
  const grg25523 = lookupValue(25523, errorDb, errorIndexes, 'grg')[0];
  assert.ok(grg25523);
  const grgHints = getSensorHintsForError('grg', grg25523.rawText, sensorIndex);
  assert.deepEqual(grgHints.pairs, [{device: 'CRM9250N', name: 'SF17'}]);
  assert.equal(grgHints.previews.length, 1);

  const ccdm21 = lookupValue(21, errorDb, errorIndexes, 'ccdm')[0];
  assert.ok(ccdm21);
  const ccdmHints = getSensorHintsForError('ccdm', ccdm21.rawText, sensorIndex);
  assert.ok(ccdmHints.pairs.length > 0);
  assert.ok(ccdmHints.pairs.every((p) => p.device === 'CCDM'));
});

test('scheme marker coordinates are normalized and gallery/group filtering covers all 16 items', () => {
  for (const scheme of schemesDb.sensor_schemes) {
    for (const [, x, y] of scheme.markers) {
      assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
    }
  }
  const allGroups = ['ccdm', 'cmd', 'grg', 'crs'] as const;
  const covered = new Set<string>();
  for (const g of allGroups) {
    for (const item of filterGalleryByGroup(schemesDb, g)) {
      covered.add(item.title);
    }
  }
  assert.equal(covered.size, schemesDb.gallery.length);
  const crsList = listSensorsByDevice(schemesDb, 'crs');
  assert.equal(crsList.length, 1);
  assert.ok(crsList[0].sensors.includes('IOT_PS1'));
});

test('parseGuideMarkdown and searchAllGuides find matches across NCR, CINEO, and GRG', () => {
  const ncrRaw = fs.readFileSync(path.join(DATA_DIR, 'ncr_a0303f0e.md'), 'utf-8');
  const cineoRaw = fs.readFileSync(path.join(DATA_DIR, 'cineo_adacbd3a.md'), 'utf-8');
  const grgRaw = fs.readFileSync(path.join(DATA_DIR, 'grg_1ebb89c6.md'), 'utf-8');

  const ncr = parseGuideMarkdown('ncr', 'NCR', 'NCR_Aptra.docx', ncrRaw);
  const cineo = parseGuideMarkdown('cineo', 'CINEO', 'CINEO_ProFlex.docx', cineoRaw);
  const grg = parseGuideMarkdown('grg', 'GRG', 'GRG_nastroika.pdf', grgRaw);

  assert.ok(ncr.sections.length >= 10);
  assert.ok(cineo.sections.length >= 5);
  assert.ok(grg.sections.length >= 5);

  const cineoSection3 = cineo.sections[2];
  const textBlock = cineoSection3.blocks.find((b) => b.kind === 'text');
  assert.ok(textBlock);
  const segments = segmentGuideText(textBlock.value);
  assert.ok(segments.some((s) => s.kind === 'code' && s.text.includes('HKEY_LOCAL_MACHINE')));

  const cross = searchAllGuides([ncr, cineo, grg], '50000');
  assert.ok(cross.some((m) => m.guideId === 'cineo'));
});

test('urlState round-trips errors, schemes, and guides parameters cleanly', () => {
  const errSearch = serializeUrlState({tab: 'errors', q: '-1335', mode: 'grg'});
  assert.equal(errSearch, '?tab=errors&q=-1335&mode=grg');
  assert.deepEqual(parseUrlState(errSearch), {
    tab: 'errors',
    q: '-1335',
    mode: 'grg',
    sensor: undefined,
    scheme: undefined,
    group: undefined,
    guide: undefined,
    section: undefined,
  });

  const schSearch = serializeUrlState({
    tab: 'schemes',
    group: 'grg',
    sensor: 'SF17',
    scheme: 'crm_up',
  });
  assert.deepEqual(parseUrlState(schSearch).sensor, 'SF17');
  assert.deepEqual(parseUrlState(schSearch).scheme, 'crm_up');

  const guideSearch = serializeUrlState({tab: 'guides', guide: 'cineo', section: 2});
  assert.deepEqual(parseUrlState(guideSearch).guide, 'cineo');
  assert.equal(parseUrlState(guideSearch).section, 2);
});

test('theme helpers resolve stored overrides, system preference fallback, and toggle cleanly', () => {
  assert.equal(parseStoredTheme('dark'), 'dark');
  assert.equal(parseStoredTheme('light'), 'light');
  assert.equal(parseStoredTheme('other'), null);
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme(null, false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(getNextTheme('light'), 'dark');
  assert.equal(getNextTheme('dark'), 'light');
});

test('pinchZoom helpers clamp scale, track finger distance/midpoint, and anchor focal scroll', () => {
  assert.equal(clampZoom(0.4), 1);
  assert.equal(clampZoom(7.2), 5);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(clampZoom(2.3456), 2.346);

  const dist = getTouchDistance({clientX: 100, clientY: 100}, {clientX: 100, clientY: 200});
  assert.equal(dist, 100);

  const mid = getTouchMidpoint({clientX: 100, clientY: 120}, {clientX: 200, clientY: 180});
  assert.deepEqual(mid, {clientX: 150, clientY: 150});

  assert.equal(computePinchZoom(100, 200, 1.5), 3);
  assert.equal(computePinchZoom(100, 30, 1.2), 1);
  assert.equal(computePinchZoom(0, 200, 1.5), 1.5);

  // Pure pinch 1x -> 2x around focal (150, 100) with initial scroll (100, 50)
  const purePinch = computeFocalScroll({
    prevZoom: 1,
    nextZoom: 2,
    prevFocalX: 150,
    prevFocalY: 100,
    nextFocalX: 150,
    nextFocalY: 100,
    currentScrollLeft: 100,
    currentScrollTop: 50,
  });
  assert.deepEqual(purePinch, {scrollLeft: 350, scrollTop: 200});

  // Two-finger pan without zoom change
  const panOnly = computeFocalScroll({
    prevZoom: 2,
    nextZoom: 2,
    prevFocalX: 150,
    prevFocalY: 100,
    nextFocalX: 170,
    nextFocalY: 80,
    currentScrollLeft: 100,
    currentScrollTop: 50,
  });
  assert.deepEqual(panOnly, {scrollLeft: 80, scrollTop: 70});
});
