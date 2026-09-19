import Dexie from 'dexie';
import { enableMapSet, enablePatches, type Patch } from 'immer';
import type { GPXFileType } from '@x-route/gpx';

enableMapSet();
enablePatches();

// File data lives in IndexedDB as the source of truth (mirrors gpx.studio's
// architecture): every mutation goes through db writes, and the UI subscribes
// reactively via useLiveQuery. Overpass POI cache tables from the source
// project are intentionally dropped — POI search is out of scope.
export class Database extends Dexie {
    fileids!: Dexie.Table<string, string>;
    // Plain data shape — structured clone drops the GPXFile prototype anyway;
    // reconstruct instances via `new GPXFile(data)` where methods are needed.
    files!: Dexie.Table<GPXFileType, string>;
    patches!: Dexie.Table<{ patch: Patch[]; inversePatch: Patch[]; index: number }, number>;
    settings!: Dexie.Table<any, string>;

    constructor() {
        super('Database', {
            cache: 'immutable',
        });
        this.version(1).stores({
            fileids: ',&fileid',
            files: '',
            patches: ',patch',
            settings: '',
        });
    }
}

export const db = new Database();
