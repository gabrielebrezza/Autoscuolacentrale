const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died`);
    });
} else {
    const express = require('express');
    const bodyParser = require('body-parser');
    const session = require('express-session');
    const bcrypt = require('bcrypt');
    const mongoose = require('mongoose');
    const path = require('path');
    const MongoDBStore = require('connect-mongodb-session')(session);

    const app = express();

    // Connessione al database MongoDB
    mongoose.connect('mongodb://localhost/autoscuola');
    const db = mongoose.connection;
    db.once('open', () => {
        console.log('Database connected');
    });
    db.on('error', (err) => {
        console.error('Connection error:', err);
    });

    // Schema per l'utente
    const UserSchema = new mongoose.Schema({
        username: String,
        password: String
    });
    const User = mongoose.model('User', UserSchema);

    const SessionSchema = new mongoose.Schema({
        sessionId: String,
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        // Altri metadati necessari
    });

    const Session = mongoose.model('Session', SessionSchema);

    const store = new MongoDBStore({
        uri: 'mongodb://localhost/autoscuola',
        collection: 'sessions'
    });

    app.use(session({
        secret: 'secret',
        resave: true,
        saveUninitialized: true,
        store: store
    }));

    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(session({
        secret: 'secret',
        resave: true,
        saveUninitialized: true
    }));

    // Imposta il percorso delle viste
    app.use(express.static(path.join(__dirname, 'public')));

    // Pagina di login
    app.get('/login', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'pages', 'login_signup.html'));
    });

    // Gestione del login
    app.post('/login', async (req, res) => {
        const { username, password } = req.body;
        const user = await User.findOne({ username });

        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.send('Username o password non validi');
        }
        console.log(`Utente ${user.username} loggato`);
        req.session.user = user;
        res.redirect('/profile');
    });

    // Pagina di registrazione
    app.get('/signup', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'pages', 'login_signup.html'));
    });

    // Gestione della registrazione
    app.post('/signup', async (req, res) => {
        const { username, password } = req.body;
        const hashedPassword = bcrypt.hashSync(password, 10);

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.send('Questo username è già stato utilizzato');
        }

        const newUser = new User({
            username,
            password: hashedPassword
        });
        await newUser.save();
        res.redirect('/login');
    });

    // Pagina del profilo
    app.get('/profile', (req, res) => {
        if (!req.session.user) {
            return res.redirect('/login');
        }
        res.send(`<h1>Benvenuto ${req.session.user.username}</h1><a href="/logout">Logout</a>`);
    });

    // Logout
    app.get('/logout', (req, res) => {
        console.log(`Utente ${req.session.user.username} disconnesso`);
        req.session.destroy();
        res.redirect('/login');
    });

    // Avvio del server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Worker ${process.pid} started. Server running on port ${PORT}`);
    });
}
