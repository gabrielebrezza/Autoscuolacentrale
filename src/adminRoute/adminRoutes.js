
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const bcrypt = require('bcrypt'); 
const bodyParser = require('body-parser');
const { create } = require('xmlbuilder2');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const archiver = require('archiver');
const tls = require('tls');

const credentials = require('../Db/User');
const Admin = require('../Db/Admin');
const guide = require('../Db/Guide');
const bacheca = require('../Db/Bacheca');
const numeroFattura = require('../Db/NumeroFattura');
const storicoFatture = require('../Db/StoricoFatture');
const formatoEmail = require('../Db/formatoEmail');
const prezzoGuida = require('../Db/CostoGuide');

//utils 
const sendEmail = require('../utils/emailsUtils');

const JWT_SECRET = 'q3o8M$cS#zL9*Fh@J2$rP5%vN&wG6^x';
// Funzione per la generazione di token JWT
function generateToken(username) {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '3d' });
}

const cartellaFatture = path.join(__dirname, 'fatture');

router.use('/fatture', express.static(cartellaFatture));

router.use(bodyParser.urlencoded({ extended: false }));

router.use(bodyParser.json());
// Middleware per l'autenticazione JWT
async function authenticateJWT(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/admin/login');
    }

    jwt.verify(token, JWT_SECRET, async (err, user) => {
        if (err) {
            return res.redirect('/admin/login');
        }
        
        // Controlla se l'utente è approvato
        try {
            const username = user.username; 
            const [nome, cognome] = username.split(" ");
            const approvedAdmin = await Admin.findOne({ "nome": nome, "cognome": cognome, "approved": true });
            
            if (!approvedAdmin) {
                return res.redirect(`/waitingApprovation/:${username}`);
            }
        } catch (error) {
            console.error('Errore durante il recupero dello stato di approvazione dell\'utente:', error);
            return res.status(500).json({ message: 'Errore del server' });
        }
        
        req.user = user;
        next();
    });
}


router.post('/logout', authenticateJWT, async (req, res) => {
    console.log(`L'istruttore ${req.user.username} ha appena effettuato il logOut`);
    res.cookie('userName', '', {maxAge: 1});
    res.redirect('/admin/login');
}); 

router.get('/admin/register', (req, res) => {
    res.render('admin/adminRegister');
});

router.post('/admin/register', async (req, res) => {
    const nome = req.body.nome.replace(/\s/g, "");
    const cognome = req.body.cognome.replace(/\s/g, "");
    const email = req.body.email.replace(/\s/g, "");
    const password = req.body.password;
    try {
        const existingAdmin = await Admin.findOne({ email });

        if (existingAdmin) {
            return res.status(400).json({ message: 'L\'utente con questo nome utente esiste già' });
        }
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(otpCode);
        saltRounds = await bcrypt.genSalt(10);
        hashedOTP = await bcrypt.hash(String(otpCode), 10);
        const newAdmin = new Admin({
            email: email,
            nome: nome,
            cognome: cognome,
            password: await bcrypt.hash(password, 10),
            otp: hashedOTP,
            approved: false,
            role: 'Istruttore'
        });

        await newAdmin.save();
        const username = `${nome} ${cognome}`;
        const subject = 'Registrazione Istruttore Autoscuola';
        const text = `Gentile ${username}, questo è il codice per verificare l'account da istruttore: ${otpCode}`;
        try{
            const result = await sendEmail(email, subject, text);
            console.log('registrazione istruttore');
            console.log(result);
            return res.redirect(`/admin/otpcode/:${username}`);
        }catch(error){
            console.log('errore: ', error);
            return res.render('errorPage', {error: `errore nell'invio dell'email con il codice OTP per la registrazione istruttore`})
        }
    } catch (error) {
        console.error('Errore durante la registrazione:', error);
        res.status(500).json({ message: 'Errore durante la registrazione' });
    }
});

router.get('/admin/login', (req, res) => {
    res.render('admin/adminLogin');
});
// Admin panel route
router.post('/admin/login', async (req, res) => {
    if(!req.body.email || !req.body.password){
        return res.render('errorPage', {error: 'Credenziali non valide'});
    }
    const email = req.body.email.replace(/\s/g, "");
    const password = req.body.password;
    try {
        // Cerca l'amministratore nel database utilizzando lo schema degli amministratori
        const admin = await Admin.findOne({ "email": email });

        // Verifica se l'amministratore esiste e se la password è corretta
        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.render('errorPage', {error: 'Credenziali non valide'});
        }
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(`Codice di verifica per ${email}: ${otpCode}`);
        saltRounds = await bcrypt.genSalt(10);
        hashedOTP = await bcrypt.hash(String(otpCode), 10);
        await Admin.findOneAndUpdate({ "email": email }, {"otp": hashedOTP});
        
        const username = `${admin.nome} ${admin.cognome}`;
        const subject = 'Login Istruttore Autoscuola';
        const text = `Gentile ${username}, questo è il codice per accedere: ${otpCode}`;
        try{
            const result = await sendEmail(email, subject, text);
            console.log('login istruttore');
            console.log(result);
            return res.redirect(`/admin/otpcode/:${username}`);
        }catch(error){
            console.log('errore: ', error);
            return res.render('errorPage', {error: `Errore nell\'invio dell\'email con il codice OTP per il login istruttore`});
        }
    } catch (error) {
        console.error('Errore durante il login:', error);
        return res.render('errorPage', {error: 'Errore durante il login' });
    }
});

router.get('/admin/otpcode/:username', async (req, res) =>{
    const userName = req.params.username.replace(':', '');
    res.render('admin/adminComponents/otpCode', {userName});
}); 
router.post('/admin/verifica_otp', async (req, res) =>{
    const userName = req.body.userName;
    const insertedOTP = Object.values(req.body).slice(-6);
    let otpString = '';
    for (const key in insertedOTP) {
        otpString += insertedOTP[key];
    }
    const [nome, cognome] = userName.split(" ");
    const check = await Admin.findOne({ "nome": nome, "cognome": cognome });
    const isOTPMatched = await bcrypt.compare(otpString, check.otp);
    if(isOTPMatched){
        const username = nome+' '+cognome;
        const token = generateToken(username);

        res.cookie('token', token, { httpOnly: true, maxAge: 604800000 });
        res.redirect(`/admin`);
    }else{
        return res.render('errorPage', {error:'Il codice OTP inserito è errato'});
    }
});

router.get('/admin', authenticateJWT, async (req, res) => {
    const istruttore = req.user.username;
    const [nome, cognome] = istruttore.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    // res.render('admin/admin', { title: 'Admin - DashBoard', role});
    res.redirect('/admin/guides');
});

router.get('/admin/guides', authenticateJWT, async (req, res) => {
    
    try {
        const istruttore = req.user.username;
        const [nome, cognome] = istruttore.split(" ");
        const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
        const guides = await guide.find();
        const infos = await credentials.find({}, { email: 1, userName: 1, cell: 1, billingInfo : 1});
        res.render('admin/adminComponents/admin-guide', { title: 'Admin - Visualizza Guide', guides: guides , istruttore, infos, role});
    } catch (error) {
        console.error('Errore durante il recupero delle guide:', error);
        return res.render('errorPage', {error: 'Errore durante il recupero delle guide' });
    }
});

router.get('/admin/users',authenticateJWT , async (req, res) => {
    try {
        const istruttore = req.user.username;
        const [nome, cognome] = istruttore.split(" ");
        const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
        const utenti = await credentials.find();
        const listaIstruttori = await Admin.find({}, 'nome cognome');
        const istruttori = listaIstruttori.map(admin => `${admin.nome} ${admin.cognome}`);
        const pricePerHour = await prezzoGuida.findOne();
        res.render('admin/adminComponents/admin-users', { title: 'Admin - Visualizza Utenti', istruttore, utenti, istruttori, role, pricePerHour});
    } catch (error) {
        console.error('Errore durante il recupero degli utenti:', error);
        return res.render('errorPage', {error: 'Errore durante il recupero degli utenti' });
    }
});
router.post('/createCode', authenticateJWT, async (req, res)=>{
    const code = (req.body.code).split(',');
    const email = req.body.utenti;
    const nCodes = Number(req.body.totaleCodici);
    const durata = req.body.durata;
    const pricePerHour = await prezzoGuida.findOne();
    let importo;
    if(durata == 'esame'){
        importo = 100;
    }else if(durata == 'trascinamento'){
        importo = 150;
    }else{
        importo = (pricePerHour.prezzo * (durata/60));
    }
    await credentials.findOneAndUpdate(
        {"email": email},
        {$inc: {"totalCodes": nCodes}}
    );
    var today = new Date();
    var day = today.getDate();
    var month = today.getMonth() + 1;
    var year = today.getFullYear();

    if (day < 10) {
        day = '0' + day;
    }
    if (month < 10) {
        month = '0' + month;
    }

    var date = day + '/' + month + '/' + year;

    for(var i = 0; i< nCodes; i++){
        await credentials.findOneAndUpdate(
            {"email": email},
            {$push: {"codicePagamento": { "codice": code[i], "data": date, "importo": importo}}},
            { new: true }
        );
    }
    res.redirect('/admin/users');
});
router.post('/ArchiviaUtente', authenticateJWT, async (req, res) =>{
    const email = req.body.email;
    const user = await credentials.findOne({"email": email});
    if (user) {
        const nuovoArchiviato = !user.archiviato;
        const archiviazione = await credentials.findOneAndUpdate(
            {"email": email},
            {$set: {"archiviato": nuovoArchiviato}}
        );
        res.json(nuovoArchiviato ? 'Utente Archiviato Con Successo' : 'Utente Rimosso Dall\'Archivio Con Successo');
    } else {
        res.json('Si è verificato un errore nell\'archiviazione dell\'Allievo');
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
router.post('/perfezionamento', authenticateJWT, async (req, res) =>{
    const {email} = req.body;
    try{
        await credentials.findOneAndUpdate(
            { "email": email, "exams.paid": false },
            { $set: { "exams.$.paid": true } }
          );
          
          await credentials.findOneAndUpdate(
            { "email": email },
            { $push: { "exams": { paid: false, bocciato: false } }, "perfezionamento": true }
          );
        res.redirect('/admin/users');
    }catch(err){
        console.log(`errore durante il perfezionamento: ${err}`);
        res.status(500)
    }
});
router.post('/trascinamento', authenticateJWT, async (req, res) =>{
    const {email} = req.body;
    try{
        await credentials.findOneAndUpdate(
            { "email": email },
            {
              $unset: { "exams": "" },
              $set: {
                "trascinamento.attivo": true,
                "trascinamento.pagato": false,
                "archiviato": false
              }
            }
          );
          
          await credentials.findOneAndUpdate(
            { "email": email },
            {
              $push: {
                "exams": {
                  "paid": false,
                  "bocciato": false
                }
              }
            }
          );
        res.redirect('/admin/users');
    }catch(err){
        console.log(`errore durante il trascinamento: ${err}`);
        res.status(500)
    }
});
router.get('/admin/guideSvolte/:username',authenticateJWT , async (req, res) => {
    try {
        const istruttore = req.user.username;
        const [nome, cognome] = istruttore.split(" ");
        const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
        const userName = req.params.username.replace(':', '');
        const guide = await credentials.findOne({"userName": userName}, {"lessonList": 1});
        res.render('admin/adminComponents/resocontoGuide', { title: 'Admin - Guide Svolte', userName, guide, role});
    } catch (error) {
        console.error('Errore durante il recupero degli utenti:', error);
        res.status(500).json({ message: 'Errore durante il recupero degli utenti' });
    }
});

router.get('/admin/addGuides',authenticateJWT , async (req, res) => {
    const instructor = req.user.username;
    const istruttori = await Admin.find({}, {nome : 1, cognome: 1, email: 1});
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    const guides = await guide.find();
    const allievi = await credentials.find({}, {"billingInfo" : 1, "email": 1});
    res.render('admin/adminComponents/addGuides', { title: 'Admin - Crea Guide', instructor, guides, role, istruttori, allievi});
});

router.post('/create-guide', authenticateJWT, async (req, res) => {
    const { startHour, lessonsNumber, duration, locationLink} = req.body;
    let istruttore;
    const instructor = req.user.username;
    const reservation = req.body.Reserved == ''? null : req.body.Reserved;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    if(role.role == 'Super'){
        istruttore = req.body.instructor;
    }else{
        istruttore = req.user.username;
    }
    const days = req.body.day.split(", ");
    try {
        const pricePerHour = await prezzoGuida.findOne();
        const price = (pricePerHour.prezzo/60) * duration;
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
                schedule.push({ hour: ora, price: price, student: null, reservedTo: reservation, locationLink: locationLink }); // assuming student is null initially
                oraDiInizio = endTime;
            }
    
            // Cerca la guida corrente nel database per l'istruttore e la data specificata
            let existingGuide = await guide.findOne({ instructor: istruttore, 'book.day': day });
    
            if (existingGuide) {
                // Se la guida esiste già per quella data, aggiungi la schedule
                await guide.updateOne(
                    { instructor: istruttore, 'book.day': day },
                    { $push: { 'book.$.schedule': { $each: schedule } } }
                );
            } else {
                // Altrimenti, crea una nuova guida per quella data
                await guide.updateOne(
                    { instructor: istruttore },
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
router.post('/deleteAllGuides', authenticateJWT, async (req, res) => {
    try {
        const { instructor, time } = req.body;
        const updatedGuide = await guide.findOneAndUpdate(
            { "instructor": instructor },
            { 
                $pull: { 
                    "book": { "day": time } 
                } 
            },
            { 
                returnOriginal: false 
            }
        );
        
        
        res.json('eliminate')
    }catch(error){
        console.error('Errore durante la rimozione della lezione di guida:', error);
        res.status(500).send('Errore durante la rimozione della lezione di guida');
    }
    });
router.post('/adminRemovebooking', authenticateJWT, async (req, res) => {
    try {
        const { instructor, time } = req.body;

        const day = time.split(' - ')[0];
        const hour = time.split(' - ')[1];
        
        const updatedGuide = await guide.findOneAndUpdate(
            { "instructor": instructor, "book.day": day },
            { 
                $pull: { 
                    "book.$.schedule": { "hour": hour } 
                }
            },
            { 
                returnOriginal: false 
            }
        );
        await guide.updateOne(
            { "instructor": instructor, "book.day": day, "book.schedule": { $size: 0 } },
            { 
                $pull: { 
                    "book": { "day": day } 
                }
            }
        );
        
        res.sendStatus(200);
    } catch (error) {
        console.error('Errore durante la rimozione della lezione di guida:', error);
        res.status(500).send('Errore durante la rimozione della lezione di guida');
    }
});

router.get('/admin/bacheca',authenticateJWT , async (req, res) => {
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    const bachecaContent = await bacheca.find();
    res.render('admin/adminComponents/editBacheca', { title: 'Admin - Modifica Bacheca',bachecaContent , instructor, role});
});
router.post('/bacheca',authenticateJWT , async (req, res) => {
    const instructor = req.user.username;
    const content = req.body.bacheca;
    try {
        const existingDocument = await bacheca.findOne();
            existingDocument.content = content;
            existingDocument.editedBy.push(instructor); 
            await existingDocument.save(); 
            console.log(`Bacheca modificata da ${instructor}`);
            res.redirect('/admin/bacheca');
    } catch (error) {
        console.error("Error while adding or updating bacheca entry:", error);
        res.status(500).send('Errore durante la modifica della bacheca');
    }


});
router.get('/admin/prezzi',authenticateJWT , async (req, res)=>{
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    const prices = await prezzoGuida.find();
    res.render('admin/adminComponents/prezzi', { title: 'Admin - Prezzi', role, prices});
});
router.post('/admin/editPrezzi', async (req, res)=>{
    try {
    const price = req.body.price;
    const prices = await prezzoGuida.updateOne({"prezzo": price});
    res.redirect('/admin/prezzi');
    } catch (error) {
        console.error("Error while adding or updating prices:", error);
        res.status(500).send('Errore durante la modifica dei prezzi');
    }
});
router.get('/admin/approvazioneUtenti',authenticateJWT , async (req, res)=>{
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    const needApprovalStudents = await credentials.find({approved: false});
    const needApprovalAdmins = await Admin.find({approved: false});
    res.render('admin/adminComponents/authUsers', { title: 'Admin - Approva Utenti', needApprovalStudents, needApprovalAdmins, role});
});
router.post('/approveUser', async (req, res) =>{
    const userName = req.body.userName;
    const email = req.body.email;
    const cell = req.body.cell;
    await credentials.findOneAndUpdate({
        "userName": userName,
        "email": email,
        "cell": cell
    },
    {
        approved: true
    }
    );
    const info = await credentials.findOne(
        {"userName": userName,"email": email,"cell": cell},
        {"billingInfo.nome": 1,"billingInfo.cognome": 1}
    );

    const subject = 'Approvazione Auto Scuola';
    const text = `Gentile ${info.billingInfo[0].nome} ${info.billingInfo[0].cognome}, ti informiamo che il tuo account è stato attivato. Accedi per prenotare le tue lezioni di guida: agenda-autoscuolacentrale.com`;
    try{
        const result = await sendEmail(email, subject, text);
        console.log('approvazione utente');
        console.log(result);
        res.redirect('/admin/approvazioneUtenti')
    }catch(error){
        console.log('errore: ', error);
        return res.render('errorPage', {error: `Errore nell\'invio dell\'email per l'approvazione.`});
    }
});

router.post('/approveAdmin', authenticateJWT, async (req, res) =>{
    const email = req.body.email;
    await Admin.findOneAndUpdate({
        "email": email
    },
    {
        approved: true
    }
    );
    res.redirect('/admin/approvazioneUtenti')
});
router.post('/disapproveAdmin', authenticateJWT, async (req, res) =>{
    const email = req.body.email;
    await Admin.deleteOne({
        "email": email
    }
    );
    res.redirect('/admin/approvazioneUtenti')
});
router.post('/disapproveUser', authenticateJWT, async (req, res) =>{
    const userName = req.body.userName;
    const email = req.body.email;
    const cell = req.body.cell;
    await credentials.deleteOne({
        "userName": userName,
        "email": email,
        "cell": cell
    }
    );
    res.redirect('/admin/approvazioneUtenti')
});

router.get('/admin/oreIstruttori', authenticateJWT, async (req, res) => {
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    const oreIstruttori = await Admin.find({}, {nome : 1, cognome : 1, email: 1, ore : 1});
    res.render('admin/adminComponents/oreIstruttori', {title: 'Admin - Orari Istruttori', oreIstruttori, role});
});

router.get('/admin/formatoEmail', authenticateJWT, async (req, res) => {
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    const formato = await formatoEmail.find({});
    res.render('admin/adminComponents/formatoEmail', {title: 'Admin - Formato Email', formato, role});
});
router.post('/editFormatoEmail', authenticateJWT, async (req, res) => {
    const content = req.body.formatoField;
    await formatoEmail.findOneAndUpdate({}, {"content": content});
    res.redirect('/admin/formatoEmail');
});
router.get('/admin/fatture/:utente',authenticateJWT , async (req, res)=>{
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    const userName = req.params.utente.replace(':', '');
    const operazioniDaFatturare = await credentials.findOne(
        {"userName": userName},
        {"fatturaDaFare": 1}
    );
    const dati = operazioniDaFatturare.fatturaDaFare;
    res.render('admin/adminComponents/fattureDaFare', {title: 'Admin - Fatture Da Emettere', dati, userName, role});
});

router.get('/admin/emettiFattura/:utente/:tipo/:data/:importo',authenticateJWT , async (req, res)=>{
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
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
    
    res.render('admin/adminComponents/creaFattura', {dati: dati, userName, tipo, data, importo, nFattura, role});
});
router.post('/createFattura', authenticateJWT, async (req, res) =>{
    let dati = req.body;
    const {numero} = await numeroFattura.findOne();
    dati.progressivoInvio = `g00${numero}`;
    dati.numeroDocumento = `g00${numero}`;
    
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
                    .ele('ImportoTotaleDocumento').txt(dati.ImportoTotaleDocumento).up()
            .up()
        .up()
        .ele('DatiBeniServizi')
            .ele('DettaglioLinee')
                .ele('NumeroLinea').txt(dati.numeroLinea1).up()
                .ele('Descrizione').txt(dati.descrizione1).up()
                .ele('PrezzoUnitario').txt(dati.prezzoUnitario1).up()
                .ele('PrezzoTotale').txt(dati.prezzoTotale1).up()
                .ele('AliquotaIVA').txt(dati.aliquotaIVA1).up()
            .up()
            .ele('DatiRiepilogo')
                .ele('AliquotaIVA').txt(dati.aliquotaIVARiepilogo1).up()
                .ele('ImponibileImporto').txt(dati.imponibileImporto1).up()
                .ele('Imposta').txt(dati.imposta1).up()
                .ele('EsigibilitaIVA').txt(dati.esigibilitaIVA).up()
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

    const xmlString = xml.end({ prettyPrint: true });
    const nomeBaseFile = `${dati.IdPaese}${dati.IdCodice}_${dati.progressivoInvio}.xml`;
    let nomeFile = nomeBaseFile;

    let counter = 1;

    while (fs.existsSync(path.join('fatture', nomeFile))) {
        nomeFile = `${nomeBaseFile}_${counter}.xml`;
        counter++;
    }
    fs.writeFile(path.join('fatture', nomeFile), xmlString, async (err) => {
    if (err) {
        console.error('Errore durante il salvataggio del file:', err);
        return res.status(500).send('Errore durante il salvataggio del file');
    } else {
        const updateFatturaDB = await credentials.findOneAndUpdate(
            {
                "userName": dati.userName,
                "fatturaDaFare": {
                    $elemMatch: {
                        "data": dati.data,
                        "tipo": dati.tipologiaFattura,
                        "importo": dati.importoPagamento,
                        "emessa": false
                    }
                }
            },
            {
                $set: {
                    "fatturaDaFare.$.emessa": true
                }
            }
        );

        const doc = new PDFDocument();


        doc.fontSize(16).text('Autoscuola Centrale', { align: 'left' });
        doc.text('Corso Marconi 33 - 10125 Torino (TO)', { align: 'left' });
        doc.text('P.IVA 06498290011', { align: 'left' });
        doc.text('Fattura di Cortesia', { align: 'right' });
        doc.moveDown();
      
        doc.moveDown();
        doc.rect(50, doc.y, 500, 1).fill('#000');
        doc.moveDown();

        doc.text('CLIENTE', { underline: true });
        doc.rect(50, doc.y + 10, 500, 200).stroke();
        doc.moveDown();
        doc.text(`Nome: ${dati.nomeCliente} ${dati.cognomeCliente}`, 60, doc.y + 20);
        doc.text(`Numero: ${dati.progressivoInvio}`, 60, doc.y + 20);
        doc.text(`Indirizzo: ${dati.indirizzoSedeCliente} ${dati.capSedeCliente} ${dati.comuneSedeCliente} (${dati.provinciaSedeCliente})`,  60, doc.y + 20);
        doc.text(`Data: ${data}`, 60, doc.y + 20);
        doc.text(`C.Fiscale: ${dati.codiceFiscaleCliente}`, 60, doc.y + 20);
        doc.moveDown();
      
        // Box per dettagli della fattura
        doc.text('Dettagli Fattura', { underline: true });
        doc.moveDown();
        doc.text('Data             Descrizione                            QTA     EURO');
        doc.text(`${data}     ${dati.descrizione1}                           ${dati.imponibileImporto1}€`);
        doc.moveDown();
        doc.fillColor("#FF0000").text(`Fattura di cortesia  non valida ai fini fiscali.`);
        doc.text(`La fattura è stata emessa in formato elettronico ed è consultabile nel cassetto fiscale`);
        doc.fillColor("#000000");
        doc.moveDown();
        doc.text('Modalità di pagamento', { underline: true });
        doc.moveDown();
        doc.text('TOTALE IMPONIBILE: ', { continued: true });
        doc.text(`${dati.imponibileImporto1} €`);
        doc.text('IVA 22%: ', { continued: true });
        doc.text(`${(Number(dati.imponibileImporto1) * 0.22).toFixed(2)} €`);
        doc.text('TOTALE FATTURA: ', { continued: true });
        doc.text(`${dati.ImportoTotaleDocumento} €`);
        doc.moveDown();
      
        doc.pipe(fs.createWriteStream(`./fatture/fattura_${dati.nomeCliente}_${dati.cognomeCliente}.pdf`));
        doc.end();

        const email = await credentials.findOne(
            {
                "userName": dati.userName,
            },
            {
                "email": 1
            }
        );
        const subject = 'Fattura di cortesia';
        const text = `Gentile ${dati.cognomeCliente} ${dati.nomeCliente} ti inviamo la fattura di cortesia per il pagamento che hai effettuato.`;
        const filename = `./fatture/fattura_${dati.nomeCliente}_${dati.cognomeCliente}.pdf`;
        try{
            const result = await sendEmail(email, subject, text, filename);
            console.log('fattura cortesia');
            console.log(result);
        }catch(error){
            console.log('errore email fattura cortesia: ', error);
        }

        const numero = parseInt(dati.progressivoInvio.replace(/\D/g, ''), 10);
        const today = new Date();
        const DD = String(today.getDate()).padStart(2, '0'); 
        const MM = String(today.getMonth() + 1).padStart(2, '0'); 
        const YYYY = today.getFullYear(); 
        const dataFatturazione = `${DD}/${MM}/${YYYY}`;
        
        const nuovaFattura = new storicoFatture({
            numero: numero,
            importo: dati.importoPagamento,
            data: dataFatturazione,
            nomeFile: nomeFile,
        });
        await  nuovaFattura.save()
        .catch((errore) => {
            console.error(`Si è verificato un errore durante l'aggiunta della fattura:`, errore);
            return res.render('errorPage', {error: `si è verificato un errore nel salvataggio della fattura contatta l'assistenza`})
        });
    
        await numeroFattura.updateOne({$inc: {"numero": 1}});
        res.redirect(`/admin/fatture/:${dati.userName}`);
    }
});
});
router.get('/admin/storicoFatture',authenticateJWT, async (req, res) => {
    try {
        const instructor = req.user.username;
        const [nome, cognome] = instructor.split(" ");
        const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
        let fattureArr = [];
        if (req.query.dataInizio && req.query.dataFine) {
            const [startD, startM, startY] = req.query.dataInizio.split('-').reverse();
            const [endD, endM, endY] = req.query.dataFine.split('-').reverse();
            const startDate = new Date(startY, startM - 1, startD);
            const endDate = new Date(endY, endM - 1, endD);  
            
            const fatture = await storicoFatture.find();
            for (let i = 0; i < fatture.length; i++) {
                const [fatturaD, fatturaM, fatturaY] = fatture[i].data.split('/');
                const fatturaDate = new Date(fatturaY, fatturaM - 1, fatturaD);
                if (fatturaDate >= startDate && fatturaDate <= endDate) {
                    fattureArr.push(fatture[i]);
                }
            }
        }else{
            fattureArr = await storicoFatture.find();
        }

        res.render('admin/adminComponents/storicoFatture', { fattureArr, role, req});
    } catch (error) {
        console.error('Si è verificato un errore durante il recupero delle fatture:', error);
        res.status(500).send('Si è verificato un errore durante il recupero delle fatture');
    }
});

router.get('/scaricaFatture', async (req, res) => {
    try {
        let nomiFile = [];
        if (req.query.dataInizio && req.query.dataFine) {
            const [startD, startM, startY] = req.query.dataInizio.split('-').reverse();
            const [endD, endM, endY] = req.query.dataFine.split('-').reverse();
            const startDate = new Date(startY, startM - 1, startD);
            const endDate = new Date(endY, endM - 1, endD);  
            
            const fatture = await storicoFatture.find();
            for (let i = 0; i < fatture.length; i++) {
                const [fatturaD, fatturaM, fatturaY] = fatture[i].data.split('/');
                const fatturaDate = new Date(fatturaY, fatturaM - 1, fatturaD);
                if (fatturaDate >= startDate && fatturaDate <= endDate) {
                    nomiFile.push(fatture[i].nomeFile);
                }
            }
        }else{
            nomiFile = await storicoFatture.distinct('nomeFile');
        }
        // Imposta il nome del file ZIP e la disposizione della risposta HTTP
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', 'attachment; filename="fatture_filtrate.zip"');

        //creazione archivio zip
        const zip = archiver('zip');

        // Reindirizzazione dell'output dell'archivio verso la risposta HTTP
        zip.pipe(res);

        for (const nomeFile of nomiFile) {
            const filePath = path.join(__dirname, '../../fatture', nomeFile);
            if (fs.existsSync(filePath)) {
                // Aggiunta del file all'archivio ZIP
                zip.append(fs.createReadStream(filePath), { name: nomeFile });
            } else {
                console.warn(`Il file ${nomeFile} non esiste nella cartella fatture.`);
            }
        }

        // Finalizzazione dell'archivio ZIP
        await zip.finalize();
    } catch (error) {
        console.error('Si è verificato un errore durante il download delle fatture filtrate:', error);
        res.status(500).send('Si è verificato un errore durante il download delle fatture filtrate');
    }
});

module.exports = router;