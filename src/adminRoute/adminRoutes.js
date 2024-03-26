
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const bcrypt = require('bcrypt'); 

const credentials = require('../Db/User');
const guide = require('../Db/Guide');

const JWT_SECRET = 'q3o8M$cS#zL9*Fh@J2$rP5%vN&wG6^x';
// Funzione per la generazione di token JWT
function generateToken(username) {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '3h' }); // Token scade dopo 3 ore
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
    const Admin = require('../Db/Admin');
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
    const Admin = require('../Db/Admin');
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
        const guides = await guide.find();
        const groupedGuides = {}; // Dati organizzati per istruttore
        // guides.forEach(g => {
        //     if (!groupedGuides[g.instructor]) {
        //         groupedGuides[g.instructor] = [];
        //     }
        //     groupedGuides[g.instructor].push(g);
        // });
        res.render('admin/adminComponents/admin-guide', { title: 'Admin - Visualizza Guide', guides: guides });
    } catch (error) {
        console.error('Errore durante il recupero delle guide:', error);
        res.status(500).json({ message: 'Errore durante il recupero delle guide' });
    }
});

// Aggiungi questa route per la pagina degli utenti
router.get('/admin/users',authenticateJWT , async (req, res) => {
    try {
        const utenti = await credentials.find({}, { userName: 1, _id: 0 });
        const usernames = utenti.map(utente => utente.userName); 
        res.render('admin/adminComponents/admin-users', { title: 'Admin - Visualizza Utenti', utenti: usernames});
    } catch (error) {
        console.error('Errore durante il recupero degli utenti:', error);
        res.status(500).json({ message: 'Errore durante il recupero degli utenti' });
    }
});


router.get('/admin/addGuides',authenticateJWT , async (req, res) => {
    res.render('admin/adminComponents/addGuides', { title: 'Admin - Crea Guide'});
});

router.post('/create-guide', authenticateJWT, async (req, res) => {
    const { instructor, day, startHour, lessonsNumber, duration } = req.body;
    try {
        let oraDiInizio = startHour;
        let schedule = [];
        const price = (45/60) * duration;
        // Calcola gli orari di inizio e fine delle lezioni e aggiungili all'array schedule
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
            // Se esiste già una guida per quell'istruttore e giorno, aggiorna l'orario della lezione
            await guide.updateOne(
                { instructor: instructor, 'book.day': newDay },
                { $push: { 'book.$.schedule': { $each: schedule } } }
            );
        } else {
            // Se non esiste, crea una nuova guida per quell'istruttore con il giorno e l'orario specificati
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


module.exports = router;