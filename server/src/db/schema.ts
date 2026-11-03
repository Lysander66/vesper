/** 当前表结构。jobs 是一次生成，http_calls 是其中每一次往返。 */

import { Database } from 'bun:sqlite'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS endpoints (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('image', 'video', 'text', 'audio')),
    definition  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  -- 调用记录还指着的凭证删不掉，只标 deleted_at 并清掉密钥。
  CREATE TABLE IF NOT EXISTS credentials (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    base_url    TEXT NOT NULL,
    api_key     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    deleted_at  TEXT
  );

  -- 流水线各阶段用哪个端点。project_id 为空是全局默认，作品可以覆盖其中某几个角色。
  CREATE TABLE IF NOT EXISTS bindings (
    id             TEXT PRIMARY KEY,
    project_id     TEXT REFERENCES projects(id) ON DELETE CASCADE,
    role           TEXT NOT NULL CHECK (role IN ('text', 'image', 'video', 'tts')),
    endpoint_id    TEXT NOT NULL REFERENCES endpoints(id),
    credential_id  TEXT NOT NULL REFERENCES credentials(id),
    -- 该角色每次调用固定带的标量参数，如 model、resolution。
    params         TEXT NOT NULL DEFAULT '{}',
    updated_at     TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uk_bindings_project_id_role ON bindings (COALESCE(project_id, ''), role);

  -- params（标量）与 inputs（素材本地路径）合起来即复现这次调用所需的全部输入。
  CREATE TABLE IF NOT EXISTS jobs (
    id                TEXT PRIMARY KEY,
    owner_kind        TEXT CHECK (owner_kind IN ('project', 'episode', 'shot', 'asset')),
    owner_id          TEXT,
    project_id        TEXT,
    episode_id        TEXT,
    purpose           TEXT,
    endpoint_id       TEXT NOT NULL REFERENCES endpoints(id),
    credential_id     TEXT NOT NULL REFERENCES credentials(id),
    params            TEXT NOT NULL,
    inputs            TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    provider_task_id  TEXT,
    error             TEXT,
    artifact_path     TEXT,
    artifacts         TEXT,
    -- 按 extract 路径从响应里实际取出的值。
    extracted         TEXT,
    -- 存用量不存金额，金额读取时按价目表计算。
    usage             TEXT,
    created_at        TEXT NOT NULL,
    finished_at       TEXT
  );

  CREATE INDEX IF NOT EXISTS ix_jobs_owner_kind_owner_id ON jobs (owner_kind, owner_id);
  CREATE INDEX IF NOT EXISTS ix_jobs_status ON jobs (status);
  CREATE INDEX IF NOT EXISTS ix_jobs_project_id ON jobs (project_id);

  -- request_body 里的素材存 $asset 引用（带本地路径），不存 base64 本体。
  CREATE TABLE IF NOT EXISTS http_calls (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id            TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    seq               INTEGER NOT NULL,
    section           TEXT NOT NULL CHECK (section IN ('submit', 'poll', 'result', 'download')),
    method            TEXT NOT NULL,
    url               TEXT NOT NULL,
    request_headers   TEXT NOT NULL,
    request_body      TEXT,
    -- 导出 cURL 时据此区分 multipart 与 JSON。
    request_encoding  TEXT NOT NULL DEFAULT 'json',
    status_code       INTEGER,
    response_headers  TEXT,
    response_body     TEXT,
    started_at        TEXT NOT NULL,
    duration_ms       INTEGER,
    error             TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uk_http_calls_job_id_seq ON http_calls (job_id, seq);

  -- 本地命令（ffmpeg）。没有端点与凭证，所以不放进 jobs。
  CREATE TABLE IF NOT EXISTS commands (
    id           TEXT PRIMARY KEY,
    owner_kind   TEXT CHECK (owner_kind IN ('project', 'episode', 'shot', 'asset')),
    owner_id     TEXT,
    kind         TEXT NOT NULL,
    argv         TEXT NOT NULL,
    cwd          TEXT NOT NULL,
    exit_code    INTEGER,
    stdout       TEXT,
    stderr       TEXT,
    artifacts    TEXT,
    started_at   TEXT NOT NULL,
    duration_ms  INTEGER,
    error        TEXT
  );

  CREATE INDEX IF NOT EXISTS ix_commands_owner_kind_owner_id ON commands (owner_kind, owner_id);

  -- 事件落库，断线重连后从上次收到的序号之后重放。
  CREATE TABLE IF NOT EXISTS runs (
    id           TEXT PRIMARY KEY,
    owner_kind   TEXT NOT NULL CHECK (owner_kind IN ('project', 'episode', 'shot', 'asset')),
    owner_id     TEXT NOT NULL,
    kind         TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
    report       TEXT,
    error        TEXT,
    started_at   TEXT NOT NULL,
    finished_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS ix_runs_owner_kind_owner_id ON runs (owner_kind, owner_id);
  CREATE INDEX IF NOT EXISTS ix_runs_status ON runs (status);

  CREATE TABLE IF NOT EXISTS run_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq      INTEGER NOT NULL,
    payload  TEXT NOT NULL,
    at       TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uk_run_events_run_id_seq ON run_events (run_id, seq);

  CREATE TABLE IF NOT EXISTS projects (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    -- 0 表示不限，合成版长度由节拍数决定。
    target_seconds    INTEGER NOT NULL DEFAULT 0,
    -- 每秒念几个字，用于预估时长。题材间差异大，允许修改。
    speech_rate       REAL NOT NULL DEFAULT 5.0,
    shot_min_seconds  REAL NOT NULL DEFAULT 5 CHECK (shot_min_seconds > 0),
    shot_max_seconds  REAL NOT NULL DEFAULT 10 CHECK (shot_max_seconds >= shot_min_seconds),
    -- 设定图与每一张首帧都逐字带上它，保证全片画风一致。
    style             TEXT NOT NULL DEFAULT '',
    aspect            TEXT NOT NULL DEFAULT '16:9' CHECK (aspect IN ('16:9', '9:16', '1:1')),
    audio_mode        TEXT NOT NULL DEFAULT 'native' CHECK (audio_mode IN ('separate', 'native')),
    continuity_mode   TEXT NOT NULL DEFAULT 'chain' CHECK (continuity_mode IN ('chain', 'cut')),
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  -- text 落库前做过 NFC 与 LF 归一化，所有字符下标都按归一化后的文本计。
  CREATE TABLE IF NOT EXISTS project_sources (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- 导入顺序，决定集号先后。
    idx         INTEGER NOT NULL,
    name        TEXT NOT NULL,
    text        TEXT NOT NULL,
    plan_state  TEXT NOT NULL DEFAULT 'draft' CHECK (plan_state IN ('draft', 'frozen')),
    frozen_at   TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uk_project_sources_project_id_idx ON project_sources (project_id, idx);

  -- 定稿时的分集清单。下次定稿逐集比对，只有区间变了的集才标过时。
  CREATE TABLE IF NOT EXISTS episode_plan_versions (
    id         TEXT PRIMARY KEY,
    source_id  TEXT NOT NULL REFERENCES project_sources(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    plan       TEXT NOT NULL,
    frozen_at  TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uk_episode_plan_versions_source_id_version ON episode_plan_versions (source_id, version);

  CREATE TABLE IF NOT EXISTS episodes (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id     TEXT NOT NULL REFERENCES project_sources(id) ON DELETE CASCADE,
    -- 作品内的全局集号，由 (source.idx, source_start) 重排得出。
    idx           INTEGER NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    synopsis      TEXT NOT NULL DEFAULT '',
    -- 原文内的字符区间 [source_start, source_end)，同一份原文的集必须连续盖满它。
    source_start  INTEGER NOT NULL,
    source_end    INTEGER NOT NULL,
    beats         TEXT NOT NULL DEFAULT '[]',
    beats_state   TEXT NOT NULL DEFAULT 'draft' CHECK (beats_state IN ('draft', 'confirmed')),
    -- 空串表示没审过，或节拍、分镜改过之后作废了。
    review        TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uk_episodes_project_id_idx ON episodes (project_id, idx);
  CREATE INDEX IF NOT EXISTS ix_episodes_source_id ON episodes (source_id);

  CREATE TABLE IF NOT EXISTS shots (
    id             TEXT PRIMARY KEY,
    episode_id     TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    idx            INTEGER NOT NULL,
    -- 这一镜出自哪个节拍，-1 为未归属。
    beat_index     INTEGER NOT NULL DEFAULT -1,
    summary        TEXT NOT NULL DEFAULT '',
    scene          TEXT NOT NULL DEFAULT '',
    camera         TEXT NOT NULL DEFAULT '',
    shot_size      TEXT NOT NULL DEFAULT 'medium' CHECK (shot_size IN ('wide', 'full', 'medium', 'close', 'extreme_close')),
    camera_move    TEXT NOT NULL DEFAULT 'static' CHECK (camera_move IN ('static', 'push', 'pull', 'pan', 'track', 'handheld')),
    mood           TEXT NOT NULL DEFAULT '',
    join_mode      TEXT NOT NULL DEFAULT 'cut' CHECK (join_mode IN ('continue', 'cut', 'fade')),
    clip_source    TEXT NOT NULL DEFAULT 'first_frame' CHECK (clip_source IN ('first_frame', 'reference')),
    image_prompt   TEXT NOT NULL DEFAULT '',
    motion_prompt  TEXT NOT NULL DEFAULT '',
    sound          TEXT NOT NULL DEFAULT '',
    -- [{ speaker, text, how }]，speaker 为 null 即旁白。单独配音下一镜只允许一个说话人。
    utterances     TEXT NOT NULL DEFAULT '[]',
    seconds        REAL NOT NULL,
    -- 以下三列存的都是资产的锁定版本 id，不是资产 id。
    cast           TEXT NOT NULL DEFAULT '[]',
    -- 空串表示这一镜不需要场景参考图。
    scene_ref      TEXT NOT NULL DEFAULT '',
    props          TEXT NOT NULL DEFAULT '[]',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uk_shots_episode_id_idx ON shots (episode_id, idx);

  -- 重新生成追加新 version，旧版保留。stale 表示上游改过，这一件尚未更新。
  CREATE TABLE IF NOT EXISTS artifacts (
    id          TEXT PRIMARY KEY,
    owner_kind  TEXT NOT NULL CHECK (owner_kind IN ('shot', 'episode')),
    owner_id    TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('first_frame', 'clip', 'voice', 'film')),
    version     INTEGER NOT NULL,
    state       TEXT NOT NULL DEFAULT 'fresh' CHECK (state IN ('fresh', 'stale')),
    path        TEXT,
    job_id      TEXT REFERENCES jobs(id),
    command_id  TEXT REFERENCES commands(id),
    created_at  TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uk_artifacts_owner_kind_owner_id_kind_version ON artifacts (owner_kind, owner_id, kind, version);
  CREATE INDEX IF NOT EXISTS ix_artifacts_owner_kind_owner_id ON artifacts (owner_kind, owner_id);

  CREATE TABLE IF NOT EXISTS assets (
    id          TEXT PRIMARY KEY,
    scope       TEXT NOT NULL CHECK (scope IN ('project', 'global')),
    project_id  TEXT,
    category    TEXT NOT NULL CHECK (category IN ('character', 'scene', 'prop', 'style', 'audio')),
    name        TEXT NOT NULL,
    data        TEXT NOT NULL,
    tags        TEXT NOT NULL DEFAULT '[]',
    state       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'locked')),
    -- 手动排的显示顺序；为空时按重要性排。
    sort_order  INTEGER,
    -- 换装才有：本体角色。外貌、身份、声音跟本体走，自己只存服装。
    base_id     TEXT REFERENCES assets(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  -- 全局资产 project_id 为空，用 COALESCE 让它们仍落在同一唯一约束下。
  CREATE UNIQUE INDEX IF NOT EXISTS uk_assets_project_id_category_name ON assets (COALESCE(project_id, ''), category, name);

  CREATE TABLE IF NOT EXISTS asset_files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id    TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    path        TEXT NOT NULL,
    job_id      TEXT REFERENCES jobs(id),
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ix_asset_files_asset_id ON asset_files (asset_id);

  -- 锁定时的快照。镜头引用版本 id，资产本身可以继续改，改完锁成下一版。
  CREATE TABLE IF NOT EXISTS asset_versions (
    id         TEXT PRIMARY KEY,
    asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL,
    data       TEXT NOT NULL,
    files      TEXT NOT NULL,
    locked_at  TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uk_asset_versions_asset_id_version ON asset_versions (asset_id, version);
`

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run(SCHEMA)
  return db
}
