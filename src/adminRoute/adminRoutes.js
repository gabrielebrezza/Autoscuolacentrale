
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const bcrypt = require('bcrypt'); 

const credentials = require('../Db/User');
const Admin = require('../Db/Admin');
const guide = require('../Db/Guide');
const bacheca = require('../Db/Bacheca');

const JWT_SECRET = 'q3o8M$cS#zL9*Fh@J2$rP5%vN&wG6^x';
// Funzione per la generazione di token JWT
function generateToken(username) {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' }); // Token scade dopo 3 ore
}

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
        console.log(infos);
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
        if(istruttori === undefined){
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
        if(istruttori === undefined){
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

router.get('/admin/addGuides',authenticateJWT , async (req, res) => {
    const instructor = req.user.username;
    res.render('admin/adminComponents/addGuides', { title: 'Admin - Crea Guide', instructor});
});

router.post('/create-guide', authenticateJWT, async (req, res) => {
    const {day, startHour, lessonsNumber, duration } = req.body;
    const instructor = req.user.username;
    try {
        let oraDiInizio = startHour;
        let schedule = [];
        const price = (45/60) * duration;
        // Calcolo orari di inizio e fine delle lezioni
        for (let i = 1; i <= lessonsNumber; i++) {
            var [startHours, startMinutes] = oraDiInizio.split(':').map(Number);
            let totalMinutes = startMinutes + Number(duration);
            let finalHours = Math.floor((startHours + Math.floor(totalMinutes / 60)) % 24);
            let finalMinutes = totalMinutes % 60;
            let endTime = `${finalHours.toString().padStart(2, '0')}:${finalMinutes.toString().padStart(2, '0')}`;
            let ora = `${oraDiInizio}-${endTime}`
            schedule.push({ hour: ora, price: price, student: null }); // assuming student is null initially
            oraDiInizio = endTime;
        }


        const [anno, mese, giorno] = day.split('-');
        const newDay = `${giorno}/${mese}/${anno}`;

        let existingGuide = await guide.findOne({ instructor: instructor, 'book.day': newDay });

        if (existingGuide) {
            await guide.updateOne(
                { instructor: instructor, 'book.day': newDay },
                { $push: { 'book.$.schedule': { $each: schedule } } }
            );
        } else {
            await guide.updateOne(
                { instructor: instructor },
                { $push: { book: { day: newDay, schedule: schedule } } },
                { upsert: true }
            );
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
router.post('/disapproveUser', async (req, res) =>{
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

router.get('/admin/fattura',authenticateJWT , async (req, res)=>{
    res.render('admin/adminComponents/creaFattura');
});
router.post('/createFattura', authenticateJWT, async (req, res) =>{
    const codiceFiscale = req.body.codiceFiscale;
    const nome = req.body.nome;
    const cognome = req.body.cognome;
    const indirizzo = req.body.indirizzo;
    const cap = req.body.cap;
    const comune = req.body.comune;
    const provincia = req.body.provincia;
    const nazione = req.body.nazione;
    
});
module.exports = router;