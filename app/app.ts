// @ts-ignore
import cors from 'cors';
import express from 'express';
import path from 'path';
import responseTime from 'response-time';
import sqlite3 from 'better-sqlite3';
import * as util from './util';

const db = sqlite3(path.join(util.APP_ROOT, 'map.db'), {
  // @ts-ignore
  // verbose: console.log,
});
const app = express();

app.use(cors());
app.use(responseTime());

app.use(express.static(path.join(util.APP_ROOT, 'static')));

function get_drop_table( result ) {

    // Return if result.drop is undefined or an Actor is dropped
    if(result.drop !== undefined && result.drop[0] === 1) { // Drops an Actor
        return undefined;
    }

    let drop_table_list = [];
    if(result.drop != 'null' && result.drop !== undefined ) {
        if(result.drop[0] == 2) {
            drop_table_list.push( result.drop[1] );
        }
    }
    // Grab Drop Table name if result.drop is like [2; table]
    if(result.drop !== undefined) {
        drop_table_list.push( result.drop[1] ); // Add specific drop table to the list
    }
    // Insert ArrowName as a Drop Table 
    if(('data' in result) && !('!Parameters' in result.data)) {
        if('ArrowName' in result.data['!Parameters']) {
            drop_table_list.push(result.data['!Parameters'].ArrowName);
        }
    }
    let out = null;
    if(drop_table_list.length > 0) {
        let commas = new Array(drop_table_list.length).fill("?").join(", ");
        const stmt = db.prepare(`SELECT data, name from drop_table where
           unit_config_name = ?
           and ( name like "Normal%" or name in (${commas}) )`);
        drop_table_list.unshift( result.name );
        out = stmt.all( drop_table_list );
    } else {
        const stmt = db.prepare(`SELECT data, name from drop_table where
           unit_config_name = ? and name like "Normal%"`);
        out = stmt.all( result.name );
    }
    if(out.length == 0) {
        return undefined;
    }
    // Convert result to JSON
    return out.reduce((acc, cur) =>
        ({ ...acc,[cur.name]: JSON.parse(cur.data)}), {});
}
function get_drop_tables( result ) {
    const stmt = db.prepare('SELECT name, data from drop_table where unit_config_name = @unit_config_name');
    const out = stmt.all({ unit_config_name: result.name });
    if(out.length == 0) {
        return undefined;
    }
    return out.reduce((acc, cur) =>
        ({ ...acc,[cur.name]: JSON.parse(cur.data)}), {});
}


function parseResult(result: any): {[key: string]: any} {
  if (!result)
    return {};

  result.data = JSON.parse(result.data);
  result.drop = JSON.parse(result.drop) || undefined;
    result.drop_table  = get_drop_table( result );
    result.drop_tables = get_drop_tables( result );
  result.equip = JSON.parse(result.equip) || undefined;
  if (!result.equip || !result.equip.length)
    result.equip = undefined;
  result.messageid = result.messageid || undefined;
  result.scale = result.scale != null ? result.scale : undefined;
  result.sharp_weapon_judge_type = result.sharp_weapon_judge_type != null ? result.sharp_weapon_judge_type : undefined;
  result.hard_mode = result.hard_mode ? true : undefined;
  // Most objects do not have DisableRankUpForMasterMode set, so don't include it unless it is set.
  result.disable_rankup_for_hard_mode = result.disable_rankup_for_hard_mode ? true : undefined;
  result.pos = [Math.round(result.data.Translate[0]*100)/100, Math.round(result.data.Translate[2]*100)/100];
  return result;
}

const FIELDS = 'objid, map_type, map_name, map_static, hash_id, unit_config_name as name, `drop`, equip, data, messageid, scale, sharp_weapon_judge_type, hard_mode, disable_rankup_for_hard_mode';

// Returns object details for an object.
app.get('/obj/:objid', (req, res) => {
  const stmt = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE objid = @objid LIMIT 1`);
  const result = parseResult(stmt.get({
    objid: parseInt(req.params.objid, 0),
  }));
  if (!result.map_type)
    return res.status(404).json({});
  res.json(result);
});

// Returns object details for an object.
app.get('/obj/:map_type/:map_name/:hash_id', (req, res) => {
  const stmt = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE map_type = @map_type
      AND map_name = @map_name
      AND hash_id = @hash_id LIMIT 1`);
  const result = parseResult(stmt.get({
    map_type: req.params.map_type,
    map_name: req.params.map_name,
    hash_id: parseInt(req.params.hash_id, 0),
  }));
  if (!result.map_type)
    return res.status(404).json({});
  res.json(result);
});

// Returns the placement generation group for an object.
app.get('/obj/:map_type/:map_name/:hash_id/gen_group', (req, res) => {
  const result = db.prepare(`SELECT ${FIELDS} FROM objs
    WHERE gen_group =
       (SELECT gen_group FROM objs
          WHERE map_type = @map_type
            AND map_name = @map_name
            AND hash_id = @hash_id LIMIT 1)`)
  .all({
    map_type: req.params.map_type,
    map_name: req.params.map_name,
    hash_id: parseInt(req.params.hash_id, 0),
  }).map(parseResult);
  if (!result.length)
    return res.status(404).json([]);
  res.json(result);
});

// Returns minimal object data for all matching objects.
function handleReqObjs(req: express.Request, res: express.Response) {
  const mapType: string|undefined = req.params.map_type;
  const mapName: string|undefined = req.params.map_name;
  const withMapNames: boolean = !!req.query.withMapNames;
  const q: string|undefined = req.query.q;
  const limit: number = parseInt(req.query.limit || 0, 10) || -1;
  if (!q) {
    res.json([]);
    return;
  }

  const getData = (x: any) => {
    x.data = undefined;
    if (!withMapNames)
      x.map_name = undefined;
    return x;
  };

  const mapNameQuery = mapName ? `AND map_name = @map_name` : '';
  const limitQuery = limit != -1 ? 'LIMIT @limit' : '';
  const query = `SELECT ${FIELDS} FROM objs
    WHERE map_type = @map_type ${mapNameQuery}
      AND objid in (SELECT rowid FROM objs_fts(@q))
    ${limitQuery}`;

  const stmt = db.prepare(query);

  res.json(stmt.all({
    map_type: mapType,
    map_name: mapName ? mapName : undefined,
    q,
    limit,
  }).map(parseResult).map(getData));
}

app.get('/objs/:map_type', handleReqObjs);
app.get('/objs/:map_type/:map_name', handleReqObjs);

// Returns object IDs for all matching objects.
function handleReqObjids(req: express.Request, res: express.Response) {
  const mapType: string|undefined = req.params.map_type;
  const mapName: string|undefined = req.params.map_name;
  const q: string|undefined = req.query.q;
  if (!q) {
    res.json([]);
    return;
  }

  const mapNameQuery = mapName ? `AND map_name = @map_name` : '';
  const query = `SELECT objid FROM objs
    WHERE map_type = @map_type ${mapNameQuery}
      AND objid in (SELECT rowid FROM objs_fts(@q))`;

  const stmt = db.prepare(query);

  res.json(stmt.all({
    map_type: mapType,
    map_name: mapName ? mapName : undefined,
    q,
  }).map(x => x.objid));
}

app.get('/objids/:map_type', handleReqObjids);
app.get('/objids/:map_type/:map_name', handleReqObjids);

app.listen(3007);
