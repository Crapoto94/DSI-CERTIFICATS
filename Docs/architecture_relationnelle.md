# Architecture Relationnelle — DSI_CERTIFICATS

> Généré le 2026-03-27 | Architecte : analyse statique complète

---

## Arbre des composants

```
DSI_CERTIFICATS/
│
├── [CORE] backend/server.js
│       Dépendances  : express, cors, multer, sqlite3, sqlite, pdf-parse, xlsx, fs, path (Node built-ins)
│       Dépendants   : (aucun — point d'entrée backend)
│       Relation      : déclenche l'initialisation DB → persiste dans database.sqlite
│                       déclenche le parsing PDF → persiste dans /file_certif/
│                       expose REST API → dépend de aucun autre module interne
│
├── [CORE] frontend/src/main.tsx
│       Dépendances  : react, react-dom/client, ./App
│       Dépendants   : (aucun — point d'entrée React)
│       Relation      : déclenche le rendu React → dépend de App
│
├── [FEATURE] frontend/src/pages/Certif.tsx
│       Dépendances  : react (useState, useEffect), lucide-react (12 icônes)
│       Dépendants   : App.tsx
│       Relation      : dépend de backend/server.js (via fetch /api/*)
│                       persiste dans backend/database.sqlite (CRUD certificats)
│                       déclenche upload PDF → persiste dans backend/file_certif/
│                       déclenche import Excel → persiste dans backend/database.sqlite
│
├── [SUB] frontend/src/App.tsx
│       Dépendances  : react, ./pages/Certif
│       Dépendants   : main.tsx
│       Relation      : dépend de Certif.tsx → déclenche son rendu
│
├── [UTILITY] backend/import_excel.js
│       Dépendances  : xlsx, sqlite3, sqlite, path, fs (Node built-ins)
│       Dépendants   : (aucun — script standalone CLI)
│       Relation      : dépend de certig.xlsx (fichier source)
│                       persiste dans backend/database.sqlite
│                       indépendant de server.js (logique upsert dupliquée)
│
└── [UTILITY] frontend/vite.config.ts
        Dépendances  : vite, @vitejs/plugin-react
        Dépendants   : build/dev pipeline Vite (tous les fichiers frontend)
        Relation      : déclenche le proxy /api → redirige vers backend:3001
                        déclenche le proxy /file_certif → redirige vers backend:3001
                        dépend de aucun fichier source interne
```

---

## Détail par composant

### [CORE] `backend/server.js`

| Attribut | Valeur |
|---|---|
| Rôle | Serveur Express + couche données SQLite + parsing PDF/Excel |
| Port | 3001 (ou `$PORT`) |
| DB | `backend/database.sqlite` — table `certificates` |
| Storage | `backend/file_certif/` — PDFs uploadés |
| Logs | `backend/logs/mouchard.log` |

**Routes exposées :**
| Méthode | Route | Action |
|---|---|---|
| GET | `/api/certificates` | Liste tous les certificats |
| POST | `/api/certificates` | Création manuelle |
| PUT | `/api/certificates/:id` | Mise à jour champs |
| PUT | `/api/certificates/:id/expiry` | Mise à jour date d'expiry |
| DELETE | `/api/certificates/:id` | Suppression |
| POST | `/api/certificates/upload` | Upload PDF unique |
| POST | `/api/certificates/upload-multiple` | Upload batch PDF |
| POST | `/api/certificates/upload-excel` | Import Excel |

**Fonctions internes :**
- `setupDb()` — initialise la table `certificates`
- `upsertCertificate(data)` — insert ou met à jour par `order_number`
- `parseCertificateFile(file)` — extrait métadonnées depuis texte PDF (regex)
- `normalizeDateString(str)` — normalise formats de date FR/ISO

---

### [CORE] `frontend/src/main.tsx`

| Attribut | Valeur |
|---|---|
| Rôle | Bootstrap React — monte `<App>` dans `#root` |
| Mode | `React.StrictMode` activé |

---

### [FEATURE] `frontend/src/pages/Certif.tsx`

| Attribut | Valeur |
|---|---|
| Rôle | UI complète de gestion des certificats |
| Lignes | ~1200+ (composant monolithique) |
| Icônes | Upload, FileText, CheckCircle, AlertCircle, Loader2, Eye, Trash2, Calendar, Edit2, Check, X, Hourglass, Search |

**États (useState) :**
| État | Type | Rôle |
|---|---|---|
| `certificates` | `Certificate[]` | Liste principale |
| `loading` | `boolean` | Chargement initial |
| `uploading` | `boolean` | Upload PDF unique |
| `batchUploading` | `boolean` | Upload batch |
| `batchProgress` | `object` | Progression batch |
| `batchDetails` | `object` | Détails résultats batch |
| `showManualForm` | `boolean` | Affichage formulaire manuel |
| `newCertificate` | `Partial<Certificate>` | État formulaire création |
| `message` | `object\|null` | Notification succès/erreur |
| `editingId` | `number\|null` | ID ligne en édition inline |
| `editingCertificate` | `Partial<Certificate>` | État édition inline |
| `searchQuery` | `string` | Filtre recherche texte |
| `showDueRenewalOnly` | `boolean` | Filtre renouvellement 3 mois |
| `sortKey` | `keyof Certificate` | Colonne de tri |
| `sortDirection` | `'asc'\|'desc'` | Direction de tri |

**Fonctions clés :**
| Fonction | HTTP | Endpoint |
|---|---|---|
| `fetchCertificates()` | GET | `/api/certificates` |
| `handleFileUpload()` | POST | `/api/certificates/upload` |
| `handleBatchUpload()` | POST | `/api/certificates/upload-multiple` |
| `handleExcelUpload()` | POST | `/api/certificates/upload-excel` |
| `handleManualAdd()` | POST | `/api/certificates` |
| `handleDelete()` | DELETE | `/api/certificates/:id` |
| `saveEdit()` | PUT | `/api/certificates/:id` |
| `filterAndSortCertificates()` | — | client-side |
| `formatDate()` | — | ISO → dd/mm/yyyy |
| `isExpired()` | — | comparaison date |

---

### [SUB] `frontend/src/App.tsx`

| Attribut | Valeur |
|---|---|
| Rôle | Shell applicatif — wraps `<Certif>` |
| Pattern | Composant passthrough sans état propre |

---

### [UTILITY] `backend/import_excel.js`

| Attribut | Valeur |
|---|---|
| Rôle | Script CLI d'import initial depuis `certig.xlsx` |
| Exécution | `node import_excel.js` — standalone |
| Note | Logique `upsertCertificate` dupliquée depuis `server.js` |

---

### [UTILITY] `frontend/vite.config.ts`

| Attribut | Valeur |
|---|---|
| Rôle | Configuration build + dev server |
| Port dev | 4100 |
| Proxy `/api` | → `http://localhost:3001` |
| Proxy `/file_certif` | → `http://localhost:3001` |

---

## Schéma de données

```
certificates (SQLite)
├── id              INTEGER PK AUTOINCREMENT
├── order_number    TEXT UNIQUE
├── request_date    TEXT
├── beneficiary_name    TEXT
├── beneficiary_email   TEXT
├── product_code    TEXT
├── product_label   TEXT
├── file_path       TEXT
├── expiry_date     TEXT
├── sedit_number    TEXT
├── is_provisional  INTEGER  (0 = confirmé, 1 = provisoire)
├── observations    TEXT
└── uploaded_at     TEXT DEFAULT CURRENT_TIMESTAMP
```

---

## Flux de données

```
PDF Upload
  Certif.tsx → POST /api/certificates/upload
    → server.js parseCertificateFile()
    → upsertCertificate() → database.sqlite
    → file → file_certif/

Excel Upload
  Certif.tsx → POST /api/certificates/upload-excel
    → server.js (xlsx parse)
    → upsertCertificate() × N → database.sqlite

Création manuelle
  Certif.tsx form → POST /api/certificates
    → server.js → database.sqlite

Édition inline
  Certif.tsx → PUT /api/certificates/:id
    → server.js → database.sqlite

Suppression
  Certif.tsx → DELETE /api/certificates/:id
    → server.js → database.sqlite + unlink file

Lecture
  Certif.tsx useEffect → GET /api/certificates
    → server.js → database.sqlite → JSON response
```
