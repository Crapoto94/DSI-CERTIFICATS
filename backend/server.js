const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 4100;

app.use(cors());
app.use(express.json());

// Serve uploaded PDFs statically
app.use('/file_certif', express.static(path.join(__dirname, 'file_certif')));

// Multer storage for PDF uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'file_certif');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Database setup
let db;
async function setupDb() {
    db = await open({
        filename: path.join(__dirname, 'database.sqlite'),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS certificates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT,
            request_date DATE,
            beneficiary_name TEXT,
            beneficiary_email TEXT,
            product_code TEXT,
            product_label TEXT,
            file_path TEXT,
            expiry_date DATE,
            sedit_number TEXT DEFAULT '',
            is_provisional INTEGER,
            observations TEXT DEFAULT '',
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const columns = await db.all("PRAGMA table_info(certificates)");
    if (!columns.some(col => col.name === 'sedit_number')) {
        await db.run("ALTER TABLE certificates ADD COLUMN sedit_number TEXT DEFAULT ''");
    }
    if (!columns.some(col => col.name === 'observations')) {
        await db.run("ALTER TABLE certificates ADD COLUMN observations TEXT DEFAULT ''");
    }
    if (!columns.some(col => col.name === 'renewal_status')) {
        await db.run("ALTER TABLE certificates ADD COLUMN renewal_status TEXT DEFAULT NULL");
    }
    if (!columns.some(col => col.name === 'renewal_comment')) {
        await db.run("ALTER TABLE certificates ADD COLUMN renewal_comment TEXT DEFAULT ''");
    }

    console.log('Database ready.');
}

async function upsertCertificate(data) {
    // Si pas de numéro de commande, utiliser "FO"
    if (!data.order_number || data.order_number.trim() === '' || data.order_number === 'Inconnu') {
        data.order_number = 'FO';
    }

    const existing = await db.get('SELECT id, file_path, is_provisional, sedit_number, expiry_date, observations FROM certificates WHERE order_number = ?', [data.order_number]);

    let result;
    if (existing && data.order_number !== 'Inconnu') {
        const finalSedit = existing.sedit_number && existing.sedit_number.trim().length > 0 ? existing.sedit_number : data.sedit_number;
        const finalExpiry = (existing.is_provisional === 0 && existing.expiry_date) ? existing.expiry_date : data.expiry_date;
        const finalProvisional = (existing.is_provisional === 0 && existing.expiry_date) ? 0 : data.is_provisional;
        const finalObservations = existing.observations && existing.observations.trim().length > 0 ? existing.observations : data.observations;

        await db.run(
            `UPDATE certificates SET
                request_date = ?, beneficiary_name = ?, beneficiary_email = ?,
                product_code = ?, product_label = ?, file_path = ?,
                expiry_date = ?, sedit_number = ?, is_provisional = ?, observations = ?
             WHERE id = ?`,
            [data.request_date, data.beneficiary_name, data.beneficiary_email,
             data.product_code, data.product_label, data.file_path,
             finalExpiry, finalSedit, finalProvisional, finalObservations, existing.id]
        );

        if (existing.file_path && existing.file_path !== data.file_path) {
            try {
                const oldPath = path.join(__dirname, existing.file_path);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            } catch (e) {
                // ignore
            }
        }
        result = { lastID: existing.id };
    } else {
        result = await db.run(
            `INSERT INTO certificates (order_number, request_date, beneficiary_name, beneficiary_email, product_code, product_label, file_path, expiry_date, sedit_number, is_provisional, observations)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.order_number, data.request_date, data.beneficiary_name, data.beneficiary_email,
             data.product_code, data.product_label, data.file_path, data.expiry_date, data.sedit_number, data.is_provisional, data.observations || '']
        );
    }

    const savedId = result.lastID;
    const saved = await db.get('SELECT * FROM certificates WHERE id = ?', [savedId]);
    return saved;
}

async function parseCertificateFile(file) {
    const filePath = file.path;
    const fileName = file.originalname;

    if (!fileName.toLowerCase().endsWith('.pdf')) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        throw new Error('Seuls les fichiers PDF sont acceptés pour les certificats.');
    }

    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);
    const content = pdfData.text || '';

    const orderMatch = content.match(/BD\d+-\d+/);
    const dateMatch = content.match(/\d{2}\/\d{2}\/\d{4}/);
    let emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
        emailMatch[0] = emailMatch[0].replace(/^[A-Z]{2,}(?=[a-z])/, '');
    }
    const productCodeMatch = content.match(/(OE2|OP2)-[A-Z]+-[A-Z]+-\d+A/);

    const formatDateToISO = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return dateStr;
    };

    const addYears = (dateStr, years) => {
        if (!dateStr) return null;
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;
        date.setFullYear(date.getFullYear() + years);
        return date.toISOString().split('T')[0];
    };

    const addDays = (dateStr, days) => {
        if (!dateStr) return null;
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
    };

    const data = {
        order_number: orderMatch ? orderMatch[0] : 'Inconnu',
        request_date: dateMatch ? formatDateToISO(dateMatch[0]) : new Date().toISOString().split('T')[0],
        beneficiary_name: 'Inconnu',
        beneficiary_email: emailMatch ? emailMatch[0] : 'Inconnu',
        product_code: productCodeMatch ? productCodeMatch[0] : 'Inconnu',
        product_label: 'Certificat Standard',
        file_path: `file_certif/${file.filename}`,
        sedit_number: '',
        is_provisional: 1,
        observations: ''
    };

    const libelleMatch = content.match(/LIBELLE\s*:\s*([^ \n]+.*)/i);
    if (libelleMatch) {
        data.product_label = libelleMatch[1].trim();
    } else {
        let type = 'Standard';
        if (data.product_code.startsWith('OP2') || data.product_code.includes('AUTH') || content.toUpperCase().includes('AGENT')) {
            type = 'Agents - G2';
        } else if (data.product_code.startsWith('OE2') || data.product_code.includes('DMT') || content.includes('Dématérialisation')) {
            type = 'Dématérialisation - G2';
        } else if (data.product_code.includes('SRV') || content.toUpperCase().includes('SERVEUR')) {
            type = 'Serveur - SSL';
        }

        let duration = '2 ans';
        if (data.product_code.endsWith('3A') || content.includes('3 ans')) {
            duration = '3 ans';
        } else if (data.product_code.endsWith('2A') || content.includes('2 ans')) {
            duration = '2 ans';
        }

        data.product_label = type !== 'Standard' ? `${type} - ${duration}` : 'Certificat Standard';
    }

    const durationMatch = data.product_label.match(/(\d+)\s*ans?/i);
    if (durationMatch) {
        data.expiry_date = addYears(data.request_date, parseInt(durationMatch[1]));
    } else {
        data.expiry_date = addDays(data.request_date, 15);
    }

    const prefNomMatch = content.match(/PRENOM \/ NOM\s*:\s*([^ \n]+.*)/i);
    if (prefNomMatch) {
        data.beneficiary_name = prefNomMatch[1].trim();
    } else {
        const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (productCodeMatch && emailMatch) {
            for (const line of lines) {
                if (line.includes(productCodeMatch[0]) && line.includes(emailMatch[0])) {
                    let namePart = line.replace(productCodeMatch[0], '').replace(emailMatch[0], '').trim();
                    if (namePart.length > 2) { data.beneficiary_name = namePart; break; }
                }
            }
        }
        if (data.beneficiary_name === 'Inconnu') {
            for (const line of lines) {
                if (line.toUpperCase().includes('JEAN FRANCOIS') && !line.includes('MANDATAIRE')) {
                    let cleaned = line
                        .replace(/\d{2}\/\d{2}\/\d{4}/g, '')
                        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
                        .replace(/BD\d+-\d+/g, '')
                        .replace(/PRENOM \/ NOM\s*:/i, '')
                        .replace(/,/g, ' ')
                        .trim();
                    if (cleaned.length > 2) { data.beneficiary_name = cleaned; break; }
                }
            }
        }
    }

    return data;
}

function normalizeDateString(dateString) {
    if (!dateString) return null;
    const d = new Date(dateString);
    if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
    }
    // Try French date format dd/mm/yyyy
    const frMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (frMatch) {
        const year = frMatch[3];
        const month = frMatch[2].padStart(2, '0');
        const day = frMatch[1].padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return null;
}

// ─── Certificate Routes ──────────────────────────────────────────────────────

app.get('/api/certificates', async (req, res) => {
    try {
        const certs = await db.all('SELECT * FROM certificates ORDER BY request_date DESC, uploaded_at DESC');
        res.json(certs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching certificates', error: error.message });
    }
});

app.post('/api/certificates', async (req, res) => {
    try {
        const {
            order_number = '',
            request_date = new Date().toISOString().split('T')[0],
            beneficiary_name = '',
            beneficiary_email = '',
            product_code = '',
            product_label = '',
            expiry_date = null,
            sedit_number = '',
            is_provisional = 1,
            observations = ''
        } = req.body;

        const finalProvisional = expiry_date ? 0 : (is_provisional ?? 1);

        const result = await db.run(
            `INSERT INTO certificates (order_number, request_date, beneficiary_name, beneficiary_email, product_code, product_label, file_path, expiry_date, sedit_number, is_provisional, observations)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [order_number, request_date, beneficiary_name, beneficiary_email, product_code, product_label, '', expiry_date, sedit_number, finalProvisional, observations]
        );

        const newCertificate = await db.get('SELECT * FROM certificates WHERE id = ?', [result.lastID]);
        res.status(201).json(newCertificate);
    } catch (error) {
        res.status(500).json({ message: 'Erreur lors de l’ajout du certificat', error: error.message });
    }
});

app.delete('/api/certificates/:id', async (req, res) => {
    try {
        const cert = await db.get('SELECT * FROM certificates WHERE id = ?', [req.params.id]);
        if (!cert) return res.status(404).json({ message: 'Certificat non trouvé' });

        if (cert.file_path) {
            const fullPath = path.join(__dirname, cert.file_path);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
                console.log(`Fichier supprimé: ${fullPath}`);
            }
        }

        await db.run('DELETE FROM certificates WHERE id = ?', [req.params.id]);

        const logMsg = `[${new Date().toISOString()}] Certificat supprimé: ID ${req.params.id} (${cert.order_number})\n`;
        fs.appendFileSync(path.join(__dirname, 'logs', 'mouchard.log'), logMsg);

        res.json({ message: 'Certificat supprimé avec succès' });
    } catch (error) {
        res.status(500).json({ message: 'Erreur lors de la suppression', error: error.message });
    }
});

app.post('/api/certificates/:id/file', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(500).json({ message: 'Erreur upload', error: err.message });
        next();
    });
}, async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Aucun fichier fourni' });
    try {
        const cert = await db.get('SELECT * FROM certificates WHERE id = ?', [req.params.id]);
        if (!cert) return res.status(404).json({ message: 'Certificat non trouvé' });

        // Supprimer l'ancien fichier si existant
        if (cert.file_path) {
            const oldPath = path.join(__dirname, cert.file_path);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }

        const newFilePath = `file_certif/${req.file.filename}`;
        await db.run('UPDATE certificates SET file_path = ? WHERE id = ?', [newFilePath, req.params.id]);
        const updated = await db.get('SELECT * FROM certificates WHERE id = ?', [req.params.id]);
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: 'Erreur lors de l\'attachement du fichier', error: error.message });
    }
});

app.put('/api/certificates/:id/renewal', async (req, res) => {
    const { renewal_status, renewal_comment } = req.body;
    try {
        await db.run(
            'UPDATE certificates SET renewal_status = ?, renewal_comment = ? WHERE id = ?',
            [renewal_status, renewal_comment || '', req.params.id]
        );
        const updated = await db.get('SELECT * FROM certificates WHERE id = ?', [req.params.id]);
        res.json({ message: 'Statut renouvellement mis à jour', certificate: updated });
    } catch (error) {
        res.status(500).json({ message: 'Erreur lors de la mise à jour', error: error.message });
    }
});

app.put('/api/certificates/:id/expiry', async (req, res) => {
    const { expiry_date } = req.body;
    try {
        await db.run('UPDATE certificates SET expiry_date = ?, is_provisional = 0 WHERE id = ?', [expiry_date, req.params.id]);
        res.json({ message: 'Date de validité mise à jour' });
    } catch (error) {
        res.status(500).json({ message: 'Erreur lors de la mise à jour', error: error.message });
    }
});

app.put('/api/certificates/:id', async (req, res) => {
    try {
        const allowedFields = ['order_number', 'request_date', 'beneficiary_name', 'beneficiary_email', 'product_code', 'product_label', 'expiry_date', 'sedit_number', 'is_provisional', 'observations', 'renewal_status', 'renewal_comment'];
        const updates = [];
        const values = [];

        allowedFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(req.body[field]);
            }
        });

        if (updates.length === 0) {
            return res.status(400).json({ message: 'Aucun champ modifiable fourni' });
        }

        // Si on met une date d'expiration manuellement, considérer comme non-provisoire
        if (req.body.expiry_date !== undefined && req.body.expiry_date !== null && !('is_provisional' in req.body)) {
            updates.push('is_provisional = ?');
            values.push(0);
        }

        values.push(req.params.id);
        const query = `UPDATE certificates SET ${updates.join(', ')} WHERE id = ?`;
        await db.run(query, values);

        const updated = await db.get('SELECT * FROM certificates WHERE id = ?', [req.params.id]);
        res.json({ message: 'Certificat mis à jour', certificate: updated });
    } catch (error) {
        res.status(500).json({ message: 'Erreur mise à jour certificat', error: error.message });
    }
});

app.post('/api/certificates/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            console.error('Multer Error:', err.message);
            return res.status(500).json({ message: 'Erreur Multer', error: err.message });
        }
        next();
    });
}, async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    try {
        const data = await parseCertificateFile(req.file);
        const saved = await upsertCertificate(data);
        res.json(saved);
    } catch (error) {
        console.error('Certif upload error:', error.message);
        const logMsg = `[${new Date().toISOString()}] ERREUR: ${error.message}\n`;
        fs.appendFileSync(path.join(__dirname, 'logs', 'mouchard.log'), logMsg);
        res.status(500).json({ message: 'Error processing certificate PDF', error: error.message });
    }
});

app.post('/api/certificates/upload-multiple', (req, res, next) => {
    upload.array('files', 20)(req, res, (err) => {
        if (err) {
            console.error('Multer Error:', err.message);
            return res.status(500).json({ message: 'Erreur Multer', error: err.message });
        }
        next();
    });
}, async (req, res) => {
    const files = req.files;
    if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ message: 'Pas de fichiers fournis.' });
    }

    const results = [];
    for (const file of files) {
        try {
            const data = await parseCertificateFile(file);
            const saved = await upsertCertificate(data);
            results.push({ file: file.originalname, status: 'ok', certificate: saved });
        } catch (error) {
            results.push({ file: file.originalname, status: 'error', message: error.message });
        }
    }
    res.json({ results });
});

app.post('/api/certificates/upload-excel', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            console.error('Multer Error:', err.message);
            return res.status(500).json({ message: 'Erreur Multer', error: err.message });
        }
        next();
    });
}, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Aucun fichier XLSX fourni.' });
    }

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

        const results = [];

        for (const [index, row] of rows.entries()) {
            const orderNumber = (row.order_number || row['N° Commande'] || row.Commande || row['Order Number'] || '').toString().trim();
            if (!orderNumber) {
                results.push({ row: index + 2, status: 'skipped', message: 'N° commande manquant' });
                continue;
            }

            const now = new Date();
            const requestDate = normalizeDateString((row.request_date || row['Date Demande'] || row['Request Date'] || now.toISOString().split('T')[0]).toString()) || now.toISOString().split('T')[0];
            const expiryDateRaw = (row.expiry_date || row['Fin Validité'] || row['Expiry Date'] || '').toString();
            const expiryDate = normalizeDateString(expiryDateRaw);

            const data = {
                order_number: orderNumber,
                request_date: requestDate,
                beneficiary_name: (row.beneficiary_name || row['Bénéficiaire'] || row['Beneficiary'] || '').toString().trim() || 'Inconnu',
                beneficiary_email: (row.beneficiary_email || row['Email'] || row['Beneficiary Email'] || '').toString().trim() || 'Inconnu',
                product_code: (row.product_code || row['Code produit'] || row['Product Code'] || '').toString().trim() || 'Inconnu',
                product_label: (row.product_label || row['Libellé produit'] || row['Product Label'] || '').toString().trim() || 'Certificat Standard',
                expiry_date: expiryDate,
                sedit_number: (row.sedit_number || row['N° Sedit'] || row['Sedit Number'] || '').toString().trim(),
                is_provisional: expiryDate ? 0 : 1,
                file_path: '',
                observations: (row.observations || row['Observations'] || '').toString().trim()
            };

            try {
                const saved = await upsertCertificate(data);
                results.push({ row: index + 2, status: 'ok', certificate: saved });
            } catch (error) {
                results.push({ row: index + 2, status: 'error', message: error.message });
            }
        }

        // Supprimer le fichier source après traitement
        try {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        } catch (e) {
            console.error('Impossible de supprimer le fichier Excel temporaire:', e.message);
        }

        res.json({ results });
    } catch (error) {
        console.error('Excel upload error:', error.message);
        res.status(500).json({ message: 'Erreur lors du traitement du fichier Excel', error: error.message });
    }
});

// ─── Start ───────────────────────────────────────────────────────────────────

setupDb().then(() => {
    app.listen(PORT, () => {
        console.log(`DSI Certificats backend running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
