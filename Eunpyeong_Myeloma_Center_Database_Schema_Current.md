# Eunpyeong St. Mary's Myeloma Center Database — 현행 스키마 (As-Is)

> **작성일**: 2026-10-23
> **기준 코드**: `db.py` (`init_db()`, `PATIENT_FIELDS`, `CHEMO_LINE_FIELDS`), `app.py` (`/api/...` 라우트)
>
> 이 문서는 **지금 코드가 만들고 사용하는 스키마**를 기록합니다. 목표 설계(CD34, Transplant, GVHD, Radiotherapy, Imaging 테이블 포함)는 `Eunpyeong_Myeloma_Center_Database_Schema.md`를 참조하세요. 두 문서가 다르면 이 문서(그리고 그보다 `db.py`/`app.py` 코드)가 현재 동작의 기준입니다.

---

## 1. 개요

| 구분 | 내용 |
| :--- | :--- |
| DBMS | PostgreSQL 전용 (로컬 실행, Vercel 배포 모두) |
| 접속 정보 | 환경변수 `POSTGRES_URL` 또는 `DATABASE_URL`. 둘 다 없으면 모든 API 요청이 500 오류를 반환하고, `EP_MMDb.bat`은 실행을 중단 |
| 드라이버 | `psycopg2` (`RealDictCursor` — 행을 dict처럼 접근) |
| 스키마 생성 | `db.init_db()` — 프로세스당 첫 요청 시 `CREATE TABLE IF NOT EXISTS` 실행 (`app.py`의 `_ensure_initialized`) |
| 마이그레이션 도구 | 없음. `init_db()`는 이미 있는 테이블을 바꾸지 않으므로, 컬럼 추가·변경은 `init_db()` 수정과 별도로 `ALTER TABLE`을 직접 실행해야 함 |
| SQL 작성 규칙 | psycopg2 placeholder `%s`, 생성된 ID는 `RETURNING`으로 받음 |

### 테이블 목록

| 테이블 | 용도 | API |
| :--- | :--- | :--- |
| `eunpyeong_mm_patients` | 환자 기본 정보 및 진단 시점 데이터 | `/api/patients` |
| `chemo_lines` | 항암 치료 라인(차수) | `/api/chemo/...` |
| `chemo_cycles` | 라인별 사이클 | 〃 |
| `chemo_cycle_agents` | 사이클별 약제 투약 스케줄 | 〃 |
| `chemo_cycle_agent_day_overrides` | 캘린더 개별 투약일 예외 | 〃 |

---

## 2. ERD

```mermaid
erDiagram
    eunpyeong_mm_patients ||--o{ chemo_lines : "upn (논리적 관계, FK 없음)"
    chemo_lines ||--o{ chemo_cycles : "line_id"
    chemo_cycles ||--o{ chemo_cycle_agents : "cycle_id"
    chemo_cycle_agents ||--o{ chemo_cycle_agent_day_overrides : "cycle_agent_id"

    eunpyeong_mm_patients {
        SERIAL id PK
        VARCHAR upn UK
        TEXT name
        INTEGER vital_status
        DATE date_last_follow-up
        TEXT "..._dx (진단 시점 항목, 전부 TEXT)"
    }
    chemo_lines {
        SERIAL line_id PK
        TEXT upn
        TEXT line_number
        TEXT regimen
        TEXT refractory_agents "JSON"
    }
    chemo_cycles {
        SERIAL cycle_id PK
        INTEGER line_id FK
        TEXT cycle_number
        TEXT start_date
        INTEGER cycle_length_days
    }
    chemo_cycle_agents {
        SERIAL cycle_agent_id PK
        INTEGER cycle_id FK
        TEXT agent_name
        TEXT dose
        TEXT dosing_days
        INTEGER schedule_order
    }
    chemo_cycle_agent_day_overrides {
        SERIAL override_id PK
        INTEGER cycle_agent_id FK
        INTEGER origin_day
        BOOLEAN is_deleted
        INTEGER moved_to_day
        TEXT override_dose
    }
```

- `chemo_lines.upn` → `eunpyeong_mm_patients.upn`은 **FK 제약이 없는 논리적 관계**입니다. 존재하지 않는 UPN으로도 라인을 만들 수 있습니다.
- chemo 하위 테이블 간 FK는 선언돼 있고 Postgres가 강제하지만 `ON DELETE CASCADE`는 없습니다. 하위 행 삭제는 `app.py`의 `write_chemo_cycles()`가 overrides → agents → cycles 순서로 직접 처리합니다.
- 인덱스는 PK와 `eunpyeong_mm_patients.upn`의 UNIQUE 인덱스뿐입니다. FK 컬럼(`line_id`, `cycle_id`, `cycle_agent_id`, `chemo_lines.upn`)에는 인덱스가 없습니다.

---

## 3. 테이블 상세

### 3.1 `eunpyeong_mm_patients` — 환자 기본 정보 및 진단 시점 데이터

`init_db()`가 키·상태 컬럼 4개를 만들고, 나머지는 `PATIENT_FIELDS` 목록에서 **모두 `TEXT`**로 생성합니다.

컬럼명에 `-`, `:`, 대문자가 들어간 것(`plasma-cell_dx`, `IGH:FGFR3_dx`, `TP53_dx`, `stage_r-iss`, `stage-r2-iss`, `date_last_follow-up`)은 SQL에서 반드시 큰따옴표로 감싸야 합니다. Postgres는 따옴표로 만든 이름의 대소문자를 구분하므로 `"TP53_dx"`와 `tp53_dx`는 다른 컬럼입니다.

#### 3.1.1 키 및 상태 컬럼

| 컬럼 | 타입 | API 쓰기 | 설명 |
| :--- | :--- | :---: | :--- |
| `id` | SERIAL PK | – | 대리키. API는 사용하지 않음 |
| `upn` | VARCHAR(8) UNIQUE | ○ | 환자 등록번호. 모든 API가 이 값으로 조회. 8자를 넘으면 INSERT 실패 |
| `vital_status` | INTEGER | ✕ | `0` = Alive, `1` = Deceased. `GET /api/patients`가 문자열로 바꿔 반환 (`1`이 아니면 전부 `Alive`) |
| `date_last_follow-up` | DATE | ✕ | 최종 추적관찰일. `GET /api/patients`에서 ISO 문자열 `last_followup_date`로 바꿔 반환 |

> `vital_status`, `date_last_follow-up`은 `PATIENT_FIELDS`에 없어서 **API로는 기록·수정할 수 없습니다**. 화면에서 등록한 환자는 둘 다 `NULL`이고 Dashboard에는 `Alive`로 표시됩니다.

#### 3.1.2 `PATIENT_FIELDS` — API가 읽고 쓰는 컬럼 (모두 TEXT)

`POST /api/patients`와 `PUT /api/patients/<upn>`은 이 목록의 **모든 컬럼**을 씁니다. 요청 JSON에 없는 키는 `NULL`이 아니라 빈 문자열 `""`로 저장되고, PUT은 부분 수정이 아니라 전체 덮어쓰기입니다. 수치 항목도 TEXT이므로 분석할 때는 `NULLIF(col, '')::numeric`처럼 변환해야 합니다. UI 값 예시는 `Add_New_Patient.html` / `Edit_Patient.html` 기준입니다.

| 컬럼 | 설명 |
| :--- | :--- |
| `name` | 환자 성명 |
| `date_birth` | 생년월일 (`YYYY-MM-DD`) |
| `sex` | 성별 |
| `date_dx` | 진단일 (`YYYY-MM-DD`, Dashboard가 진단일로 표시) |
| `chain_heavy` | Heavy chain (IgG, IgA, IgM, IgD, IgE, Negative) |
| `chain_light` | Light chain (kappa, lambda, Negative) |
| `hg_dx` | Hemoglobin (g/dL) |
| `b2mg_dx` | β2-microglobulin (mg/L) |
| `bun_dx`, `cr_dx` | BUN / Creatinine (mg/dL). 화면의 한 입력란(`BUN/Cr`)을 나눠 저장 |
| `tp_dx`, `alb_dx` | Total protein / Albumin (g/dL). `TP/Alb` 입력란을 나눠 저장 |
| `hyperca_dx`, `renal_dx`, `anemia_dx`, `osetlytic_dx` | CRAB의 C / R / A / B (`+`, `-`). 한 입력란을 4개로 나눠 저장. `osetlytic`은 원래 철자 오류지만 컬럼명이므로 그대로 유지 |
| `height_dx`, `bwt_dx` | 진단 시 신장(cm) / 체중(kg) |
| `dp_dx` | 질환 분류 (MGUS, Smoldering, Symptomatic, PCL 등) |
| `paraskeletal_dx`, `emd_dx` | Paraskeletal disease / Extramedullary disease 여부 |
| `tb_dx` | Total bilirubin (mg/dL) |
| `ast_dx`, `alt_dx` | AST / ALT (U/L). `AST/ALT` 입력란을 나눠 저장 |
| `ca_dx`, `ldh_dx` | Calcium (mg/dL) / LDH (U/L) |
| `ig_g_dx`, `ig_a_dx`, `ig_m_dx` | 혈청 IgG / IgA / IgM (mg/dL). 한 입력란을 나눠 저장 |
| `ig_d_dx`, `ig_e_dx` | 혈청 IgD / IgE. 한 입력란을 나눠 저장 |
| `kappa_dx`, `lambda_dx` | Serum free kappa / lambda (mg/L) |
| `serum_m_dx`, `urine_m_dx` | 혈청 M-protein (g/dL) / 24시간 소변 M-protein |
| `hbsag_dx`, `hbsab_dx` | HBs Ag / HBs Ab. 한 입력란을 나눠 저장 |
| `hbcab_dx`, `anti_hcv_dx`, `hiv_dx` | HBc Ab / Anti-HCV / HIV |
| `cellularity_dx` | 골수 cellularity (%) |
| `plasma-cell_dx` | 골수 형질세포 비율 (%) |
| `cytogenetics_dx` | 핵형 (e.g. `46,XY[20]`) |
| `IGH:FGFR3_dx` | t(4;14) (%) |
| `IGH:CCND1_dx` | t(11;14) (%) |
| `IGH:MAF_dx` | t(14;16) (%) |
| `IGH:MAFB_dx` | t(14;20) (%) |
| `TP53_dx` | del(17p13) (%) |
| `CKS1B_dx` | gain(1q21) (%) |
| `RB1_dx` | del(13q14) (%) |
| `CDKN2C_dx` | del(1p32) (%) |
| `stage_ds` | Durie-Salmon 병기 |
| `stage_iss` | ISS 병기 |
| `stage_r-iss` | R-ISS 병기 |
| `stage-r2-iss` | R2-ISS 병기 (구분자가 다른 컬럼과 달리 `-`) |

#### 3.1.3 API ↔ 컬럼 매핑

| 엔드포인트 | 동작 |
| :--- | :--- |
| `GET /api/patients` | `SELECT *` 전체. `vital_status` → `'Alive'`/`'Deceased'`, `date_last_follow-up` → `last_followup_date`(ISO 문자열)로 변환 |
| `GET /api/patients/<upn>` | `SELECT *` 1건, 변환 없음. `date_last_follow-up`은 Flask 기본 JSON 직렬화로 `Tue, 01 Oct 2024 00:00:00 GMT` 같은 HTTP 날짜 형식이 됨 |
| `POST /api/patients` | `PATIENT_FIELDS` 전체 INSERT. `upn` 중복이면 UNIQUE 위반 → 500 |
| `PUT /api/patients/<upn>` | `PATIENT_FIELDS` 전체 UPDATE (`upn` 자체도 요청 값으로 바뀔 수 있음) |

삭제 API는 없습니다.

---

### 3.2 `chemo_lines` — 치료 라인 (차수)

한 행이 환자의 한 치료 라인입니다. Chemotherapy 화면은 한 번 로드할 때 한 라인을 편집합니다.

| 컬럼 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `line_id` | SERIAL PK | – | 라인 ID. 첫 저장 후 URL에 `&line_id=`로 붙음 |
| `upn` | TEXT | – | 환자 UPN (FK 제약 없음) |
| `line_number` | TEXT | – | 치료 차수 (First, Consolidation, Maintenance, Second ~ Twelfth) |
| `regimen` | TEXT | – | 레지멘명 (`Eunpyeong_Myeloma_Center_Chemo-regimens.json` 프리셋 또는 `Others`) |
| `custom_regimen` | TEXT | – | `regimen = Others`일 때 직접 입력값 |
| `date_first_response` | TEXT | – | 최초 반응 평가일 (`YYYY-MM-DD` 문자열) |
| `depth_first_response` | TEXT | `'SD'` | 최초 반응 깊이 (sCR, CR, VGPR, PR, MR, SD, PD, NE) |
| `date_best_response` | TEXT | – | 최적 반응 평가일 |
| `depth_best_response` | TEXT | `'SD'` | 최적 반응 깊이 |
| `disease_progression` | TEXT | `'No'` | 진행 여부 (Yes / No) |
| `date_progression` | TEXT | – | 진행일 |
| `end_of_tx_date` | TEXT | – | 치료 종료일 |
| `cessation_reason` | TEXT | `'Completed'` | 종료 사유 (Completed, Disease progression, Toxicity / Side effects, Patient refusal, Death, Others) |
| `custom_cessation_reason` | TEXT | – | `cessation_reason = Others`일 때 직접 입력값 |
| `progression_type` | TEXT | – | 진행 양상 (Biochemical, Clinical, both) |
| `toxicity_specify` | TEXT | – | 독성 상세 |
| `toxicity_grade` | TEXT | – | 독성 등급 (I ~ V) |
| `refractory_agents` | TEXT | – | JSON 문자열 `{ "<약제명>": "Yes" \| "No" }`. 서버가 `json.dumps`/`json.loads`로 변환하므로 API에서는 객체로 주고받음 |

> 컬럼 기본값은 INSERT에서 컬럼을 생략할 때만 적용되는데, API는 항상 모든 컬럼을 명시하므로(값이 없으면 `NULL`) 실제로는 쓰이지 않습니다. 기본값은 화면 쪽 초기값이 정합니다.

### 3.3 `chemo_cycles` — 사이클

| 컬럼 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `cycle_id` | SERIAL PK | – | 사이클 ID (저장할 때마다 새로 발급됨, 3.6 참고) |
| `line_id` | INTEGER, FK → `chemo_lines.line_id` | – | 소속 라인 |
| `cycle_number` | TEXT | – | 사이클 이름/번호 (e.g. `1`, `2`) |
| `start_date` | TEXT | – | 사이클 시작일 |
| `cycle_length_days` | INTEGER | `28` | 사이클 길이(일) |

조회 순서는 `ORDER BY cycle_id`(= 저장 시 배열 순서)입니다.

### 3.4 `chemo_cycle_agents` — 사이클별 약제 투약 스케줄

행 하나는 "사이클의 약제 1건"이 아니라 **"사이클 안의 투약 스케줄 1건"**입니다. 같은 약제가 용량·투여일이 다른 여러 스케줄로 나뉘면 같은 `(cycle_id, agent_name)`이 여러 행이 됩니다.

| 컬럼 | 타입 | 설명 |
| :--- | :--- | :--- |
| `cycle_agent_id` | SERIAL PK | 스케줄 ID |
| `cycle_id` | INTEGER, FK → `chemo_cycles.cycle_id` | 소속 사이클 |
| `agent_class` | TEXT | 약제 분류 (`Eunpyeong_Myeloma_Center_Chemo-agents.json`의 `Class`) |
| `agent_name` | TEXT | 약제명 (`Others`로 직접 입력한 경우 그 이름) |
| `dose` | TEXT | 용량. 프리셋이든 직접 입력(`Others`)이든 최종 텍스트를 그대로 저장. 로드할 때 `app.js`가 프리셋 값이 아니면 `dose: 'Others'` + `customDose`로 다시 나눔 |
| `dosing_days` | TEXT | 투여일 코드 또는 자유 텍스트 (e.g. `QW4`, `D1,4,8,11`). `dose`와 같은 방식으로 저장·복원 |
| `schedule_order` | INTEGER | 표시 순서. 요청에 없으면 사이클 안의 배열 순서(1부터) |

조회 순서는 `ORDER BY schedule_order, cycle_agent_id`입니다.

### 3.5 `chemo_cycle_agent_day_overrides` — 캘린더 개별 투약일 예외

Treatment Schedule 캘린더에서 특정 날짜의 투약을 삭제·이동하거나 용량을 바꾼 경우에만 행이 생깁니다. 예외가 없는 날짜는 `dosing_days` 패턴대로 표시됩니다.

| 컬럼 | 타입 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- |
| `override_id` | SERIAL PK | – | 예외 ID |
| `cycle_agent_id` | INTEGER, FK → `chemo_cycle_agents.cycle_agent_id` | – | 대상 스케줄 |
| `origin_day` | INTEGER | – | 패턴상 원래 투약 일차 (사이클 시작일 기준 Day 번호) |
| `is_deleted` | BOOLEAN | `FALSE` | 그날 투약을 삭제했는지 여부 |
| `moved_to_day` | INTEGER | – | 다른 날로 옮긴 경우 옮긴 일차, 아니면 `NULL` |
| `override_dose` | TEXT | – | 그날에만 적용하는 용량 (바꾼 경우에만 값 있음) |

> `(cycle_agent_id, origin_day)`는 화면 로직상 유일하지만(`app.js`가 `origin_day`를 키로 쓰는 객체로 관리) DB에 UNIQUE 제약은 없습니다.

### 3.6 chemo 저장 방식 (통째로 교체)

`POST /api/chemo/patient/<upn>/lines`와 `PUT /api/chemo/lines/<line_id>`는 라인 필드와 사이클 트리 전체를 한 번에 받습니다. 서버(`write_chemo_cycles`)는 그 라인의 기존 overrides → agents → cycles를 **전부 지운 뒤 다시 INSERT**합니다. 그래서:

- `chemo_lines.line_id`는 유지되지만 `cycle_id`, `cycle_agent_id`, `override_id`는 **저장할 때마다 새 값**이 됩니다. 이 ID들을 다른 곳에서 참조하면 안 됩니다.
- 라인 삭제 API는 없습니다.

| 엔드포인트 | 동작 |
| :--- | :--- |
| `GET /api/chemo/patient/<upn>/lines` | 환자의 라인 목록 (`line_id`, `line_number`, `regimen`, `custom_regimen`), `line_id` 순 |
| `POST /api/chemo/patient/<upn>/lines` | 라인과 사이클 트리 생성, `{ "line_id": n }` 반환 |
| `GET /api/chemo/lines/<line_id>` | 라인 + `cycles[].agents[].day_overrides[]` 중첩 JSON |
| `PUT /api/chemo/lines/<line_id>` | 라인 필드 갱신 + 사이클 트리 전체 교체 |

---

## 4. DB 밖에 저장되는 데이터

| 화면 | 저장 위치 | 비고 |
| :--- | :--- | :--- |
| Transplant (`/transplant`) | 브라우저 `localStorage` 키 `hemaCDS_transplant_data` | 환자 구분 없이 **JSON 1건**만 저장. 이식 유형/차수, 공여자·수혜자 정보, HLA, 전처치·GVHD 예방 약제, 주입 세포(`infusedCells[]`), G-CSF·IVIG, `savedAt` 포함. 브라우저·PC마다 따로 저장되고 서버에는 남지 않음 |
| Baseline Characteristics, CD34+ Collection, GVHD, Radiotherapy, Imaging, Engraftment | 저장 안 됨 | 해당 테이블·API 없음 |

---

## 5. 현행 스키마의 알려진 문제

1. **`vital_status` / `date_last_follow-up` 입력 경로 없음** — API와 화면에서 수정할 수 없음 (3.1.1).
2. **진단 시점 수치가 전부 TEXT** — 빈 값은 `""`로 저장되어 숫자 비교·통계 전에 변환이 필요함 (3.1.2).
3. **참조 무결성 부족** — `chemo_lines.upn`에 FK가 없고, FK 컬럼에 인덱스가 없음.
4. **스키마 변경 수단 없음** — `init_db()`는 `CREATE TABLE IF NOT EXISTS`만 실행하므로 이미 있는 테이블에 컬럼을 추가하려면 `ALTER TABLE`을 별도로 실행해야 함.
5. **`GET /api/patients/<upn>`의 날짜 형식** — `date_last_follow-up`이 ISO가 아닌 HTTP 날짜 형식으로 반환됨 (3.1.3).
6. **Transplant 데이터가 서버에 없음** — `localStorage` 키 하나에만 저장되어 환자별 기록과 백업이 불가능함.
