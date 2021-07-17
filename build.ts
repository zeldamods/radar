import CRC32 from 'crc-32';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'better-sqlite3';

import {PlacementMap, PlacementObj, PlacementLink, ResPlacementObj} from './app/PlacementMap';
import * as util from './app/util';

const actorinfodata = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'ActorInfo.product.json'), 'utf8'));

const names: {[actor: string]: string} = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'names.json'), 'utf8'));
const getUiName = (name: string) => names[name] || name;
const locationMarkerTexts: {[actor: string]: string} = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'text', 'StaticMsg', 'LocationMarker.json'), 'utf8'));
const dungeonTexts: {[actor: string]: string} = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'text', 'StaticMsg', 'Dungeon.json'), 'utf8'));

const drop_data = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'drop_table.json'), 'utf8'));

const db = sqlite3('map.db.tmp');
db.pragma('journal_mode = WAL');

db.exec(`
  DROP TABLE IF EXISTS objs;
  CREATE TABLE objs (
   objid INTEGER PRIMARY KEY,
   map_type TEXT NOT NULL,
   map_name TEXT NOT NULL,
   map_static BOOL,
   gen_group INTEGER,
   hash_id INTEGER,
   unit_config_name TEXT NOT NULL,
   ui_name TEXT NOT NULL,
   data JSON NOT NULL,
   one_hit_mode BOOL DEFAULT 0,
   last_boss_mode BOOL DEFAULT 0,
   hard_mode BOOL DEFAULT 0,
   disable_rankup_for_hard_mode BOOL DEFAULT 0,
   scale INTEGER DEFAULT 0,
   sharp_weapon_judge_type INTEGER DEFAULT 0,
   'drop' JSON,
   equip JSON,
   ui_drop TEXT,
   ui_equip TEXT,
   messageid TEXT
  );
`);

db.exec(`
   DROP TABLE IF EXISTS drop_table;
   CREATE TABLE drop_table (
     unit_config_name TEXT NOT NULL,
     name TEXT NOT NULL,
     data JSON
  );
`);



const insertObj = db.prepare(`INSERT INTO objs
  (map_type, map_name, map_static, gen_group, hash_id, unit_config_name, ui_name, data, one_hit_mode, last_boss_mode, hard_mode, disable_rankup_for_hard_mode, scale, sharp_weapon_judge_type, 'drop', equip, ui_drop, ui_equip, messageid)
  VALUES
  (@map_type, @map_name, @map_static, @gen_group, @hash_id, @unit_config_name, @ui_name, @data, @one_hit_mode, @last_boss_mode, @hard_mode, @disable_rankup_for_hard_mode, @scale, @sharp_weapon_judge_type, @drop, @equip, @ui_drop, @ui_equip, @messageid)`);

function getActorData(name: string) {
  const h = CRC32.str(name) >>> 0;
  const hashes = actorinfodata['Hashes'];
  let a = 0, b = hashes.length - 1;
  while (a <= b) {
    const m = (a + b) >> 1;
    if (hashes[m] < h)
      a = m + 1;
    else if (hashes[m] > h)
      b = m - 1;
    else
      return actorinfodata['Actors'][m];
  }
  return null;
}

function isFlag4Actor(name: string) {
  if (name == 'Enemy_GanonBeast')
    return false;
  const info = getActorData(name);
  for (const x of ['Enemy', 'GelEnemy', 'SandWorm', 'Prey', 'Dragon', 'Guardian']) {
    if (info['profile'] == x)
      return true;
  }
  if (info['profile'].includes('NPC'))
    return true;
  return false;
}

function shouldSpawnObjForLastBossMode(obj: PlacementObj) {
  const name: string = obj.data.UnitConfigName;
  if (isFlag4Actor(name))
    return false;
  if (name == 'Enemy_Guardian_A')
    return false;
  if (name.includes('Entrance') || name.includes('WarpPoint') || name.includes('Terminal'))
    return false;
  return true;
}

function objGetUiName(obj: PlacementObj) {
  if (obj.data.UnitConfigName === 'LocationTag') {
    const id = obj.data['!Parameters'].MessageID;
    const locationName = locationMarkerTexts[id] || dungeonTexts[id];
    let s = `Location: ${locationName}`;
    const dungeonSub = dungeonTexts[id + '_sub'];
    if (dungeonSub)
      s += ' - ' + dungeonSub;
    return s;
  }
  return getUiName(obj.data.UnitConfigName);
}

function objGetDrops(params: any) {
  if (params.DropActor)
    return [1, params.DropActor];
  if (!params.DropActor && params.DropTable && params.DropTable != 'Normal')
    return [2, params.DropTable];
  return null;
}

function objGetUiDrops(params: any) {
  const info: string[] = [];
  if (params.DropActor)
    info.push(getUiName(params.DropActor));
  else if (params.DropTable && params.DropTable != 'Normal')
    info.push('Table:' + params.DropTable);
  return info.join('|');
}

function objGetEquipment(params: any) {
  const info: string[] = [];
  for (const prop of ['EquipItem1', 'EquipItem2', 'EquipItem3', 'EquipItem4', 'EquipItem5', 'RideHorseName']) {
    if ((prop in params) && params[prop] != 'Default')
      info.push(params[prop]);
  }
  if (params['ArrowName'] && params['ArrowName'] != 'NormalArrow') {
    info.push(params['ArrowName']);
  }
  return info;
}

function objGetUiEquipment(params: any) {
  return objGetEquipment(params).map(getUiName).join(', ');
}

function processMap(pmap: PlacementMap, isStatic: boolean): void {
  process.stdout.write(`processing ${pmap.type}/${pmap.name} (static: ${isStatic})`);
  const hashIdToObjIdMap: Map<number, any> = new Map();

  const genGroups: Map<number, PlacementObj[]> = new Map();
  const genGroupSkipped: Map<number, boolean> = new Map();
  for (const obj of pmap.getObjs()) {
    if (!genGroups.has(obj.genGroupId))
      genGroups.set(obj.genGroupId, []);
    genGroups.get(obj.genGroupId)!.push(obj);
  }
  for (const [id, genGroup] of genGroups.entries())
    genGroupSkipped.set(id, genGroup.some(o => !shouldSpawnObjForLastBossMode(o)));

  for (const obj of pmap.getObjs()) {
    const params = obj.data['!Parameters'];

    let scale = params ? params.LevelSensorMode : 0;
    if (!obj.data.UnitConfigName.startsWith('Weapon_') && !obj.data.UnitConfigName.startsWith('Enemy_'))
      scale = null;

    const result = insertObj.run({
      map_type: pmap.type,
      map_name: pmap.name,
      map_static: isStatic ? 1 : 0,
      gen_group: obj.genGroupId,
      hash_id: obj.data.HashId,
      unit_config_name: obj.data.UnitConfigName,
      ui_name: objGetUiName(obj),
      data: JSON.stringify(obj.data),
      one_hit_mode: (params && params.IsIchigekiActor) ? 1 : 0,
      last_boss_mode: genGroupSkipped.get(obj.genGroupId) ? 0 : 1,
      hard_mode: (params && params.IsHardModeActor) ? 1 : 0,
      disable_rankup_for_hard_mode: (params && params.DisableRankUpForHardMode) ? 1 : 0,
      scale,
      sharp_weapon_judge_type: params ? params.SharpWeaponJudgeType : 0,
      drop: params ? JSON.stringify(objGetDrops(params)) : null,
      equip: params ? JSON.stringify(objGetEquipment(params)) : null,
      ui_drop: params ? objGetUiDrops(params) : null,
      ui_equip: params ? objGetUiEquipment(params) : null,
      messageid: params ? (params['MessageID'] || null) : null,
    });
    hashIdToObjIdMap.set(obj.data.HashId, result.lastInsertRowid);
  }

  process.stdout.write('.\n');
}

function processMaps() {
  const MAP_PATH = path.join(util.APP_ROOT, 'content/map');
  for (const type of fs.readdirSync(MAP_PATH)) {
    const typeP = path.join(MAP_PATH, type);
    for (const name of fs.readdirSync(typeP)) {
      const nameP = path.join(typeP, name);
      if (!util.isDirectory(nameP))
        continue;

      let fileName = `${name}_Static.json`;
      let data: object = JSON.parse(fs.readFileSync(path.join(nameP, fileName), 'utf8'));
      const staticMap = new PlacementMap(type, name, data);

      fileName = `${name}_Dynamic.json`;
      data = JSON.parse(fs.readFileSync(path.join(nameP, fileName), 'utf8'));
      const dynamicMap = new PlacementMap(type, name, data);

      processMap(staticMap, true);
      processMap(dynamicMap, false);
    }
  }
}
db.transaction(() => processMaps())();

function create_drop_table() {
    let stmt = db.prepare(`INSERT INTO drop_table (unit_config_name, name, data) VALUES (@unit_config_name, @name, @data)`);
    drop_data.forEach((row : any) => {
        let result = stmt.run( row );
    });
}

console.log('creating drop data table...');
db.transaction( () => create_drop_table() )();

function createIndexes() {
  db.exec(`
    CREATE INDEX objs_map ON objs (map_type, map_name);
    CREATE INDEX objs_map_type ON objs (map_type);
    CREATE INDEX objs_hash_id ON objs (hash_id);
    CREATE INDEX objs_gen_group ON objs (gen_group);
    CREATE INDEX objs_unit_config_name ON objs (unit_config_name);
  `);
}
console.log('creating indexes...');
createIndexes();

function createFts() {
  db.exec(`
    CREATE VIRTUAL TABLE objs_fts USING fts5(content="", map, actor, name, data, 'drop', equip, onehit, lastboss, hard, no_rankup, scale, bonus, static);

    INSERT INTO objs_fts(rowid, map, actor, name, data, 'drop', equip, onehit, lastboss, hard, no_rankup, scale, bonus, static)
    SELECT objid, map_type||'/'||map_name, unit_config_name, ui_name, data, ui_drop, ui_equip, one_hit_mode, last_boss_mode, hard_mode, disable_rankup_for_hard_mode, scale, sharp_weapon_judge_type, map_static FROM objs;
  `);
}
console.log('creating FTS tables...');
createFts();

db.close();
fs.renameSync('map.db.tmp', 'map.db');
