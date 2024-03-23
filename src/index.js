const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const paypal = require('paypal-rest-sdk');

//DB schemas
const credentials = require('./Db/User');
const guide = require('./Db/Guide');
// Aggiungi cookie-parser come middleware per gestire i cookie

paypal.configure({
    mode: "sandbox",
    client_id: "AQ_o9Yz9c5nvarfJulXNOBctDZHOPZd4_KsotSdq7K4lcwlDi1gRBi_kJaNICV93KP5n2cmAdxBKngpi",
    client_secret: "ELznTnRYt4XSn1bNM00e56zPWFbZm_kROe-J5YOAKpO9mQCC-iz0RoblN6fktd6Ojjw5tFgY5XpLzlga"
});

const app = express();

const JWT_SECRET = 'q3o8M$cS#zL9*Fh@J2$rP5%vN&wG6^x';

app.use(cookieParser());

app.use(express.json());

app.use(express.urlencoded({extended: false}));

app.set('view engine', 'ejs');

app.use(express.static('public'));

app.use(bodyParser.urlencoded({ extended: false}));

app.get('/', (req, res) =>{
    res.render('login');
});

//Register user
app.post("/signup", async (req, res) =>{
    const data = {
        userName: req.body.username,
        password: req.body.password
    }
    //check if the user already exist
    const existingUser = await credentials.findOne({userName: data.userName});
    if(existingUser){
        res.send('<h1>Esiste già un account con questo nome</h1>');
    }else{
        //encrypting password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(data.password, saltRounds);

        data.password = hashedPassword;

        const userData = await credentials.insertMany(data);
        console.log('nuovo utente registrato: ', data.userName);
        res.redirect('/');
    }
});


// Middleware per controllare l'autenticazione
const isAuthenticated = (req, res, next) => {
    const usernameCookie = req.cookies.username;
    const usernameURL = req.params.username;

    if (usernameCookie && usernameCookie === usernameURL.replace(":", "")) {
        // User authenticated
        return next();
    } else {
        // User not authenticated
        res.redirect('/');
    }
};

app.post('/login', async (req, res) => {
    try {
        const check = await credentials.findOne({ userName: req.body.username });
        if (!check) {
            res.send('This username does not exist');
        }

        // Check the password
        const sixMonths = 180 * 24 * 60 * 60 * 1000;
        const isPasswordMatch = await bcrypt.compare(req.body.password, check.password);
        if (isPasswordMatch) {
            // Imposta il cookie di autenticazione
            res.cookie('username', req.body.username, { maxAge: sixMonths, httpOnly: true });
            console.log('Nuovo utente loggato: ', req.body.username);
            res.redirect(`/profile/:${req.body.username}`);
        } else {
            res.send('Password errata');
        }
    } catch {
        res.send('Credenziali sbagliate');
    }
});

app.get('/profile/:username', isAuthenticated, async (req, res) => {
    const lezioni = await guide.find();
    const nome = req.params.username.replace(':', '');
    res.render('guideBooking', { nome, lezioni});
});
app.post('/book', async (req, res) => {
    try {
        const { instructor, time, student } = req.body;

        // Aggiorna il documento della guida
        const updatedGuide = await guide.findOneAndUpdate(
            { "instructor": instructor, "book.day": time.split(' - ')[0], "book.schedule.hour": time.split(' - ')[1] },
            { $set: { "book.$.schedule.$[elem].student": student } },
            { arrayFilters: [{ "elem.hour": time.split(' - ')[1] }] }
        );

        res.sendStatus(200);
    } catch (error) {
        console.error('Errore durante la prenotazione:', error);
        res.status(500).send('Errore durante la prenotazione');
    }
});

app.post('/removebooking', async (req, res) => {
    try {
        const { instructor, time } = req.body;

        // Aggiorna il documento della guida
        const updatedGuide = await guide.findOneAndUpdate(
            { "instructor": instructor, "book.day": time.split(' - ')[0], "book.schedule.hour": time.split(' - ')[1] },
            { $unset: { "book.$.schedule.$[elem].student": "" } },
            { arrayFilters: [{ "elem.hour": time.split(' - ')[1] }] }
        );

        res.sendStatus(200);
    } catch (error) {
        console.error('Errore durante la rimozione della prenotazione:', error);
        res.status(500).send('Errore durante la rimozione della prenotazione');
    }
});





app.post('/create-payment', (req, res) =>{
    const instructor = req.body.instructor;
    const time = req.body.time;
    const student = req.body.student;
    console.log('sta per pagare ', req.body);
    const returnUrl = `http://localhost:5000/success?instructor=${encodeURIComponent(instructor)}&time=${encodeURIComponent(time)}&student=${encodeURIComponent(student)}`;

    const create_payment_json = {
        intent: "sale",
        payer: {
            payment_method: "paypal"
        },
        redirect_urls: {
            return_url: returnUrl,
            cancel_url: "http://localhost:5000/cancel",
        },
        transactions: [
            {
                item_list: {
                    items: [
                        {
                            name: "Lezione di Guida",
                            sku: "Item SKU",
                            price: "12.00",
                            currency: "EUR",
                            quantity: 1
                        }
                    ]
                },
                amount: {
                    currency: "EUR",
                    total: "12.00"
                },
                description: "Pagamento effettuato per la lezione di guida"
            }
        ]
        
    };

    paypal.payment.create(create_payment_json, (error, payment)=>{
        if(error){
            throw error;
        } else{
            for(i = 0; i < payment.links.length; i++){
                if(payment.links[i].rel === "approval_url"){
                    res.redirect(payment.links[i].href);
                }
            }
        }
    });
});



app.get('/success', async (req, res) =>{
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;

    const execute_payment_json = {
        payer_id: payerId,
        transactions: [
            {
                amount: {
                    currency: "EUR",
                    total: "12.00"
                }
            }
        ]
    };

    paypal.payment.execute(paymentId, execute_payment_json, async (error, payment) =>{
        if(error){
            console.error(error.response);
            throw error
        } else{
            const instructor = req.query.instructor;
            const time = req.query.time;
            const student = req.query.student;

            fetch('http://localhost:5000/book', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ instructor, time, student })
            })
            .then(response => {
                if (response.ok) {
                    console.log('Prenotazione effettuata con successo dopo il pagamento', req.query);
                    // Reindirizza l'utente alla pagina del profilo
                    res.redirect(`/profile/${req.cookies.username}`);
                } else {
                    console.error('Errore durante la prenotazione dopo il pagamento');
                    // Gestisci l'errore in modo appropriato
                    res.redirect(`/profile/${req.cookies.username}`);
                }
            })
            .catch(error => {
                console.error('Errore durante la prenotazione dopo il pagamento:', error);
                // Gestisci l'errore in modo appropriato
                res.redirect(`/profile/${req.cookies.username}`);
            });
        }
    });
});

app.get('/cancel', async (req, res) =>{
    res.render('payments/cancel');
});




// Funzione per la generazione di token JWT
function generateToken(username) {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '3h' }); // Token scade dopo 1 ora
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

app.get('/admin/register', (req, res) => {
    res.render('adminRegister');
});

app.post('/admin/register', async (req, res) => {
    const Admin = require('./Db/Admin');
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




app.get('/admin/login', (req, res) => {
    res.render('admin/adminLogin'); // Renderizza la pagina di login dell'amministratore
});
// Admin panel route
app.post('/admin/login', async (req, res) => {
    const Admin = require('./Db/Admin');
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
        res.status(200).json({ message: 'Login riuscito' });
    } catch (error) {
        console.error('Errore durante il login:', error);
        res.status(500).json({ message: 'Errore durante il login' });
    }
});

// Rotta protetta
app.get('/admin', authenticateJWT, async (req, res) => {
    res.render('admin/admin', { title: 'Admin - DashBoard'}); // Invia la pagina HTML protetta
});

app.get('/admin/guides',authenticateJWT, async (req, res) => {
    try {
        const guides = await guide.find(); // Recupera tutte le guide dal database
        res.render('admin/adminComponents/admin-guide', { title: 'Admin - Visualizza Guide', guides: guides });
    } catch (error) {
        console.error('Errore durante il recupero delle guide:', error);
        res.status(500).json({ message: 'Errore durante il recupero delle guide' });
    }
});

// Aggiungi questa route per la pagina degli utenti
app.get('/admin/users',authenticateJWT , async (req, res) => {
    res.render('admin/adminComponents/admin-users', { title: 'Admin - Visualizza Utenti' });
});



app.post('/payPP', async (req, res) => {
    res.json({ message: 'Form data received successfully'})
});










const port = 5000;
app.listen(port, () =>{
    console.log('Server running on Port: ' + port);
})