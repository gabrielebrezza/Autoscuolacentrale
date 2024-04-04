
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const bcrypt = require('bcrypt'); 
const bodyParser = require('body-parser');
const { create } = require('xmlbuilder2');
const fs = require('fs');

const credentials = require('../Db/User');
const Admin = require('../Db/Admin');
const guide = require('../Db/Guide');
const bacheca = require('../Db/Bacheca');
const numeroFattura = require('../Db/NumeroFattura');
const formatoEmail = require('../Db/formatoEmail');

const JWT_SECRET = 'q3o8M$cS#zL9*Fh@J2$rP5%vN&wG6^x';
// Funzione per la generazione di token JWT
function generateToken(username) {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' }); // Token scade dopo 3 ore
}
router.use(bodyParser.urlencoded({ extended: false }));

// Parse application/json
router.use(bodyParser.json());
// Middleware per l'autenticazione JWT
function authenticateJWT(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ message: 'Nessun token fornito' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Autenticazione fallita' });
        }
        req.user = user;
        next();
    });
}

router.get('/admin/register', (req, res) => {
    res.render('admin/adminRegister');
});

router.post('/admin/register', async (req, res) => {

    const { username, password } = req.body;
    try {
        // Cerca l'amministratore nel database utilizzando lo schema degli amministratori
        const existingAdmin = await Admin.findOne({ username });

        // Verifica se l'amministratore esiste già
        if (existingAdmin) {
            return res.status(400).json({ message: 'L\'utente con questo nome utente esiste già' });
        }

        // Crea un nuovo documento Admin
        const newAdmin = new Admin({
            userName: username,
            password: await bcrypt.hash(password, 10) // Cripta la password prima di salvarla
        });

        // Salva il nuovo amministratore nel database
        await newAdmin.save();

        res.status(201).json({ message: 'Registrazione riuscita' });
    } catch (error) {
        console.error('Errore durante la registrazione:', error);
        res.status(500).json({ message: 'Errore durante la registrazione' });
    }
});




router.get('/admin/login', (req, res) => {

    res.render('admin/adminLogin'); // Renderizza la pagina di login dell'amministratore
});
// Admin panel route
router.post('/admin/login', async (req, res) => {

    const { username, password } = req.body;
    try {
        // Cerca l'amministratore nel database utilizzando lo schema degli amministratori
        const admin = await Admin.findOne({ userName: username });

        // Verifica se l'amministratore esiste e se la password è corretta
        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(401).json({ message: 'Credenziali non valide' });
        }

        // Genera il token JWT
        const token = generateToken(username);

        // Imposta il token come cookie
        res.cookie('token', token, { httpOnly: true });

        // Restituisci un messaggio di login riuscito
        res.redirect('/admin');
    } catch (error) {
        console.error('Errore durante il login:', error);
        res.status(500).json({ message: 'Errore durante il login' });
    }
});

// Rotta protetta
router.get('/admin', authenticateJWT, async (req, res) => {
    res.render('admin/admin', { title: 'Admin - DashBoard'}); // Invia la pagina HTML protetta
});

router.get('/admin/guides', authenticateJWT, async (req, res) => {
    
    try {
        const istruttore = req.user.username;
        const guides = await guide.find();
        const infos = await credentials.find({}, { email: 1, userName: 1, cell: 1 });
        res.render('admin/adminComponents/admin-guide', { title: 'Admin - Visualizza Guide', guides: guides , istruttore, infos});
    } catch (error) {
        console.error('Errore durante il recupero delle guide:', error);
        res.status(500).json({ message: 'Errore durante il recupero delle guide' });
    }
});

router.get('/admin/users',authenticateJWT , async (req, res) => {
    try {
        const istruttore = req.user.username;
        const utenti = await credentials.find();
        const listaIstruttori = await Admin.find({}, 'userName');
        const istruttori = listaIstruttori.map(admin => admin.userName);
        res.render('admin/adminComponents/admin-users', { title: 'Admin - Visualizza Utenti', istruttore, utenti, istruttori});
    } catch (error) {
        console.error('Errore durante il recupero degli utenti:', error);
        res.status(500).json({ message: 'Errore durante il recupero degli utenti' });
    }
});
router.post('/excludeInstructor', authenticateJWT, async (req, res) =>{
    try {
        const student = req.body.student;
        const istruttori = Array.isArray(req.body.istruttori) ? req.body.istruttori : [req.body.istruttori];
        if(istruttori !== undefined){
            await credentials.updateMany({userName: student}, { $addToSet: { exclude: { $each: istruttori.map(name => ({ instructor: name })) } } });
            res.redirect('/admin/users');
        }else{
            res.redirect('/admin/users');
        }
    } catch (error) {
        console.error('Errore durante l\'esclusione degli istruttori:', error);
        res.status(500).json({ message: 'Errore durante l\'esclusione degli istruttori' });
    }
});

router.post('/includeInstructor', authenticateJWT, async (req, res) =>{
    try {
        const student = req.body.student;
        const istruttori = Array.isArray(req.body.istruttori) ? req.body.istruttori : [req.body.istruttori];
        if(istruttori !== undefined){
            const include = await credentials.updateMany(
              { userName: student },
              { $pull: { exclude: { instructor: { $in: istruttori } } } }
            );
            res.redirect('/admin/users');
        }else{
            res.redirect('/admin/users');
        }   
    } catch (error) {
        console.error('Errore durante l\'esclusione degli istruttori:', error);
        res.status(500).json({ message: 'Errore durante l\'inclusione degli istruttori' });
    }
});
router.post('/boccia', authenticateJWT, async (req, res) =>{
    const {studente, posizioneBocciato} = req.body;
    const esameBocciato = await credentials.findOneAndUpdate(
        {"userName" : studente},
        {$set: { ["exams." + posizioneBocciato + ".bocciato"] : true}}
    );
    res.json('Utente Bocciato con successo');
});
router.get('/admin/addGuides',authenticateJWT , async (req, res) => {
    const instructor = req.user.username;
    const guides = await guide.find();
    res.render('admin/adminComponents/addGuides', { title: 'Admin - Crea Guide', instructor, guides});
});

router.post('/create-guide', authenticateJWT, async (req, res) => {
    const { startHour, lessonsNumber, duration, locationLink} = req.body;
    const instructor = req.user.username;
    const days = req.body.day.split(", "); // Ottieni un array di date nel formato "gg/mm/aaaa"
    try {
        const price = (45/60) * duration;
        for (const day of days) { // Itera su ogni data
            let oraDiInizio = startHour;
            let schedule = [];
            // Calcolo orari di inizio e fine delle lezioni
            for (let i = 1; i <= lessonsNumber; i++) {
                var [startHours, startMinutes] = oraDiInizio.split(':').map(Number);
                let totalMinutes = startMinutes + Number(duration);
                let finalHours = Math.floor((startHours + Math.floor(totalMinutes / 60)) % 24);
                let finalMinutes = totalMinutes % 60;
                let endTime = `${finalHours.toString().padStart(2, '0')}:${finalMinutes.toString().padStart(2, '0')}`;
                let ora = `${oraDiInizio}-${endTime}`
                schedule.push({ hour: ora, price: price, student: null, locationLink: locationLink }); // assuming student is null initially
                oraDiInizio = endTime;
            }
    
            // Cerca la guida corrente nel database per l'istruttore e la data specificata
            let existingGuide = await guide.findOne({ instructor: instructor, 'book.day': day });
    
            if (existingGuide) {
                // Se la guida esiste già per quella data, aggiungi la schedule
                await guide.updateOne(
                    { instructor: instructor, 'book.day': day },
                    { $push: { 'book.$.schedule': { $each: schedule } } }
                );
            } else {
                // Altrimenti, crea una nuova guida per quella data
                await guide.updateOne(
                    { instructor: instructor },
                    { $push: { book: { day: day, schedule: schedule } } },
                    { upsert: true }
                );
            }
        }
    
        res.redirect('/admin/addGuides');
    } catch (error) {
        console.error('Errore durante la creazione della guida:', error);
        res.status(500).json({ message: 'Errore durante la creazione della guida' });
    }    
});


router.post('/adminRemovebooking', authenticateJWT, async (req, res) => {
    try {
        const { instructor, time } = req.body;

        const updatedGuide = await guide.findOneAndUpdate(
            { "instructor": instructor, "book.day": time.split(' - ')[0] },
            { $pull: { "book.$.schedule": { "hour": time.split(' - ')[1] } } }
        );
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Errore durante la rimozione della lezione di guida:', error);
        res.status(500).send('Errore durante la rimozione della lezione di guida');
    }
});

router.get('/admin/bacheca',authenticateJWT , async (req, res) => {
    const instructor = req.user.username;
    const bachecaContent = await bacheca.find();
    res.render('admin/adminComponents/editBacheca', { title: 'Admin - Modifica Bacheca',bachecaContent , instructor});
});
router.post('/bacheca',authenticateJWT , async (req, res) => {
    const instructor = req.user.username;
    const content = req.body.bacheca;
    try {
        const existingDocument = await bacheca.findOne(); // Cerca un documento esistente con lo stesso valore di content
            existingDocument.content = content;
            existingDocument.editedBy.push(instructor); // Aggiunge l'istruttore all'array editedBy
            await existingDocument.save(); // Salva il documento aggiornato
            res.redirect('/admin/bacheca')
    } catch (error) {
        console.error("Error while adding or updating bacheca entry:", error);
        res.status(500).send('Errore durante la modifica della bacheca');
    }


});
router.get('/admin/approvazioneUtenti',authenticateJWT , async (req, res)=>{
    const needApproval = await credentials.find({approved: false});
    res.render('admin/adminComponents/authUsers', { title: 'Admin - Approva Utenti', needApproval});
});
router.post('/approveUser', async (req, res) =>{
    const userName = req.body.userName;
    const email = req.body.email;
    const cell = req.body.cell;
    const approve = await credentials.findOneAndUpdate({
        "userName": userName,
        "email": email,
        "cell": cell
    },
    {
        approved: true
    }
    );
    res.redirect('/admin/approvazioneUtenti')
});
router.post('/disapproveUser', authenticateJWT, async (req, res) =>{
    const userName = req.body.userName;
    const email = req.body.email;
    const cell = req.body.cell;
    const disapprove = await credentials.deleteOne({
        "userName": userName,
        "email": email,
        "cell": cell
    },
    {
        approved: true
    }
    );
    res.redirect('/admin/approvazioneUtenti')
});

router.get('/admin/oreIstruttori', authenticateJWT, async (req, res) => {
    const oreIstruttori = await Admin.find({}, {userName : 1, ore : 1});
    res.render('admin/adminComponents/oreIstruttori', {title: 'Admin - Orari Istruttori', oreIstruttori});
});

router.get('/admin/formatoEmail', authenticateJWT, async (req, res) => {
    const formato = await formatoEmail.find({});
    res.render('admin/adminComponents/formatoEmail', {title: 'Admin - Formato Email', formato});
});
router.post('/editFormatoEmail', authenticateJWT, async (req, res) => {
    const content = req.body.formatoField;

    const editFormato = await formatoEmail.findOneAndUpdate({}, {"content": content});
    res.redirect('/admin/formatoEmail');
});
router.get('/admin/fatture/:utente',authenticateJWT , async (req, res)=>{
    const userName = req.params.utente.replace(':', '');
    const operazioniDaFatturare = await credentials.findOne(
        {"userName": userName},
        {"fatturaDaFare": 1}
    );
        const dati = operazioniDaFatturare.fatturaDaFare;
    res.render('admin/adminComponents/fattureDaFare', {title: 'Admin - Fatture Da Emettere', dati, userName});
});

router.get('/admin/emettiFattura/:utente/:tipo/:data/:importo',authenticateJWT , async (req, res)=>{
    const userName = req.params.utente;
    const tipo = req.params.tipo;
    const data = decodeURIComponent(req.params.data);
    const importo = req.params.importo;
    const datiFatturazione = await credentials.findOne(
        {"userName": userName},
        {"billingInfo": 1}
    );
    const nFattura = await numeroFattura.find();
    const dati = datiFatturazione.billingInfo;
    
    res.render('admin/adminComponents/creaFattura', {dati: dati, userName, tipo, data, importo, nFattura});
});
router.post('/createFattura', authenticateJWT, async (req, res) =>{
    // Estrai i dati dalla richiesta
    const dati = req.body;
    const data = (((dati.data).split('/')).reverse()).join('-'); 
    // Costruisci il documento XML della fattura elettronica
    const xml = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('p:FatturaElettronica')
    .att('xmlns:ds', 'http://www.w3.org/2000/09/xmldsig#')
    .att('xmlns:p', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2')
    .att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
    .att('versione', 'FPR12')
    .att('xsi:schemaLocation', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd')        .ele('FatturaElettronicaHeader')
            .ele('DatiTrasmissione')
                .ele('IdTrasmittente')
                    .ele('IdPaese').txt(dati.IdPaese).up()
                    .ele('IdCodice').txt(dati.IdCodice).up()
                .up()
                .ele('ProgressivoInvio').txt(dati.progressivoInvio).up()
                .ele('FormatoTrasmissione').txt(dati.formatoTrasmissione).up()
                .ele('CodiceDestinatario').txt(dati.codiceDestinatario).up()
                .ele('ContattiTrasmittente')
                    .ele('Telefono').txt(dati.telefonoTrasmittente).up()
                    .ele('Email').txt(dati.emailTrasmittente).up()
                .up()
            .up()
            .ele('CedentePrestatore')
                .ele('DatiAnagrafici')
                    .ele('IdFiscaleIVA')
                        .ele('IdPaese').txt(dati.IdPaese).up()
                        .ele('IdCodice').txt(dati.IdCodice).up()
                    .up()
                    .ele('CodiceFiscale').txt(dati.codiceFiscaleCedente).up()
                    .ele('Anagrafica')
                        .ele('Denominazione').txt(dati.denominazioneCedente).up()
                    .up()
                    .ele('RegimeFiscale').txt(dati.regimeFiscaleCedente).up()
                .up()
                .ele('Sede')
                    .ele('Indirizzo').txt(dati.indirizzoSedeCedente).up()
                    .ele('CAP').txt(dati.capSedeCedente).up()
                    .ele('Comune').txt(dati.comuneSedeCedente).up()
                    .ele('Provincia').txt(dati.provinciaSedeCedente).up()
                    .ele('Nazione').txt(dati.nazioneSedeCedente).up()
                .up()
            .up()
            .ele('CessionarioCommittente')
                .ele('DatiAnagrafici')
                    .ele('CodiceFiscale').txt(dati.codiceFiscaleCliente).up()
                    .ele('Anagrafica')
                        .ele('Nome').txt(dati.nomeCliente).up()
                        .ele('Cognome').txt(dati.cognomeCliente).up()
                    .up()
                .up()
                .ele('Sede')
                    .ele('Indirizzo').txt(dati.indirizzoSedeCliente).up()
                    .ele('CAP').txt(dati.capSedeCliente).up()
                    .ele('Comune').txt(dati.comuneSedeCliente).up()
                    .ele('Provincia').txt(dati.provinciaSedeCliente).up()
                    .ele('Nazione').txt(dati.nazioneSedeCliente).up()
                .up()
            .up()
        .up()
        .ele('FatturaElettronicaBody')
            .ele('DatiGenerali')
                .ele('DatiGeneraliDocumento')
                    .ele('TipoDocumento').txt(dati.tipoDocumento).up()
                    .ele('Divisa').txt(dati.divisa).up()
                    .ele('Data').txt(data).up()
                    .ele('Numero').txt(dati.numeroDocumento).up()
            .up()
        .up()
        .ele('DatiBeniServizi')
            .ele('DettaglioLinee')
                .ele('NumeroLinea').txt(dati.numeroLinea1).up()
                .ele('Descrizione').txt(dati.descrizione1).up()
                .ele('PrezzoUnitario').txt(dati.prezzoUnitario1).up()
                .ele('PrezzoTotale').txt(dati.prezzoTotale1).up()
                .ele('AliquotaIVA').txt(dati.aliquotaIVA1).up()
                .ele('Natura').txt(dati.natura1).up()
            .up()
            .ele('DatiRiepilogo')
                .ele('AliquotaIVA').txt(dati.aliquotaIVARiepilogo1).up()
                .ele('ImponibileImporto').txt(dati.imponibileImporto1).up()
                .ele('Imposta').txt(dati.imposta1).up()
                // .ele('TotaleDocumento').txt(dati.TotaleDocumento).up()
            .up()
        .up()
        .ele('DatiPagamento')
            .ele('CondizioniPagamento').txt(dati.condizioniPagamento).up()
            .ele('DettaglioPagamento')
                .ele('ModalitaPagamento').txt(dati.modalitaPagamento).up()
                .ele('ImportoPagamento').txt(dati.importoPagamento)
            .up()
        .up()
    .up();

    // Converti il documento XML in una stringa
    const xmlString = xml.end({ prettyPrint: true });
    const cliente = dati.nomeCliente + dati.cognomeCliente;
    const nomeFile = `${dati.IdPaese}${dati.IdCodice}_${dati.progressivoInvio}.xml`;
    fs.writeFile(nomeFile, xmlString, async (err) => {
    if (err) {
        console.error('Errore durante il salvataggio del file:', err);
        res.status(500).send('Errore durante il salvataggio del file');
    } else {

        const updateFatturaDB = await credentials.findOneAndUpdate(
            {
                "userName": dati.userName,
                "fatturaDaFare.data": dati.data,
                "fatturaDaFare.tipo": dati.tipologiaFattura,
                "fatturaDaFare.importo": dati.importoTotaleDocumento
            },
            {
                $set: {
                    "fatturaDaFare.$.emessa": true
                }
            }
        );
        const nFattura = await numeroFattura.updateOne({$inc: {"numero": 1}});
        res.set('Content-Type', 'application/xml');
        res.set('Content-Disposition', 'attachment; filename="' + nomeFile + '"');
        res.send(xmlString); 
    }
});
});
module.exports = router;