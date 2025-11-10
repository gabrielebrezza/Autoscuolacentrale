
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
const LessonsDB = require('../Db/Lessons');
const CodesDB = require('../Db/Codes');

//utils 
const sendEmail = require('../utils/emailsUtils');
const { createInvoice } = require('../utils/invoiceUtils');
const { randomInt, randomUUID } = require('crypto');

const JWT_SECRET = 'q3o8M$cS#zL9*Fh@J2$rP5%vN&wG6^x';
function generateToken(username) {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '3d' });
}

const cartellaFatture = path.join('fatture');

// router.use('/fatture', authenticateJWT, express.static(cartellaFatture));

// router.use(bodyParser.urlencoded({ extended: false }));

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

const authenticateIscrizioneAPI = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === process.env.API_KEY_AGENDA) {
        next();
    } else {
        console.log(`Accesso non autorizzato tentato alle fatture da IP: ${req.ip}, URL: ${req.originalUrl}`);
        res.status(403).send('Forbidden');
    }
};

router.post('/admin/downloadFatturaCortesia', authenticateJWT, async (req, res)=> {
    try {
        const fileName = req.body.file;
        if (fileName) {
            const filePath = path.join('fatture', 'cortesia', fileName);
            if (fs.existsSync(filePath)) {
                res.set('Content-Type', 'application/pdf');
                res.set('Content-Disposition', `attachment; filename="${fileName}"`);
        
                const fileStream = fs.createReadStream(filePath);
                fileStream.pipe(res);
            } else {
                console.warn(`Il file ${fileName} non esiste nella cartella fatture.`);
                res.status(404).send('File not found');
            }
        } else {
            console.warn(`Nessuna fattura specificata.`);
            res.status(404).send('Fattura non specificata');
        }
    } catch (error) {
        console.error('Si è verificato un errore durante il download della fattura di cortesia:', error);
    res.render('errorPage', {error: 'Si è verificato un errore durante il download della fattura di cortesia'});
    }
});

router.post('/admin/api/newUser', authenticateIscrizioneAPI, async (req, res) => {
    try {
        const dati = req.body;
        if(!!(await credentials.findOne({"email": dati.email}))) return res.status(404).json({success: false});
        let username = dati.email.split('@')[0];
        let usernameChecked;
        while(!usernameChecked){
            const utente = await credentials.findOne({"userName": username});
            if(!utente) usernameChecked = true;
            if(utente) username+=randomInt(0, 9);
        }
        const length = randomInt(7, 12);
        let password = '';
        const chars = '1234567890!?"£$%&/()=^'
        for (let i = 0; i < length; i++) {
            password+=chars[randomInt(0, 22)];
        }
        
        const examIndex = (Number(dati.teoriaLength) - Number(dati.countTeoriaAssente)) - 1;
        let expirationFoglioRosa;
        if(dati[`esitoEsame${examIndex}`] == 'idoneo'){
            expirationFoglioRosa = new Date(dati[`dataEsame${examIndex}`]);
            expirationFoglioRosa.setFullYear(expirationFoglioRosa.getFullYear() + 1);
            expirationFoglioRosa.setDate(expirationFoglioRosa.getDate() + 1);
        }
        
        const saveUser = new credentials({
            email: dati.email,
            cell: dati.tel,
            userName: username,
            password: await bcrypt.hash(password, await bcrypt.genSalt(10)),
            approved: true,
            exams: [{paid: false, bocciato: false}],
            licenseNumber: dati.nPatente,
            expirationFoglioRosa: expirationFoglioRosa,
            billingInfo: [
                {
                    nome: dati.nome,
                    cognome: dati.cognome,
                    codiceFiscale: dati.cf,
                    via: dati.viaResidenza,
                    nCivico: dati.civicoResidenza,
                    CAP: dati.capResidenza,
                    citta: dati.comuneResidenza,
                    provincia: dati.provinciaResidenza,
                    stato: 'IT'
                }
            ]
        });
        await saveUser.save();
        try{
            const subject = 'Agenda Guide';
            const text = `Complimenti! Hai superato l'esame di teoria. Adesso potrai accedere all'agenda per poter prenotare le guide, vai su agenda-autoscuolacentrale.com e inserisci le seguenti credenziali: email: ${dati.email}, telefono: ${dati.tel}, username: ${username}, password: ${password} Ci raccomandiamo di cambiare subito la password, premendo su ho dimenticato la password, per questioni di sicurezza. `
            const result = await sendEmail(dati.email, subject, text);
            console.log(result);
        }catch(error){
            console.log('errore: ', error);
        }
        res.status(200).json({success: true});
    } catch (error) {
        console.log(`Si è verificato un'errore nella ricezione del nuovo utente ${error}`);
        res.status(500).json({success: false});
    }
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
    res.redirect('/admin/guides');
});

// router.get('/admin/guides', authenticateJWT, async (req, res) => {
//     try {
//         const istruttore = req.user.username;
//         const [nome, cognome] = istruttore.split(" ");
//         const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
//         const guides = await guide.find();
//         const infos = await credentials.find({}, { email: 1, userName: 1, cell: 1, billingInfo : 1});
//         res.render('admin/adminComponents/admin-guide', { title: 'Admin - Visualizza Guide', guides: guides , istruttore, infos, role});
//     } catch (error) {
//         console.error('Errore durante il recupero delle guide:', error);
//         return res.render('errorPage', {error: 'Errore durante il recupero delle guide' });
//     }
// });

router.get('/admin/guides', authenticateJWT, async (req, res) => {
    try {
        const istruttore = req.user.username;
        const [nome, cognome] = istruttore.split(" ");
        const admin = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});

        const now = new Date();
        const fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        const toDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);

        const lessonsQuery = {"day": { $gte: new Date(fromDate), $lte: new Date(toDate) }};

        const lessons = await LessonsDB.find(lessonsQuery).populate('instructor', 'nome cognome').populate('student', 'billingInfo email cell userName')

        const giorniMap = new Map();
  
        lessons.forEach(l => {
          const giorno = new Date(l.day).toLocaleDateString('it-IT', {year: "numeric", month: "2-digit", day: "2-digit"});
          const istruttoreId = l.instructor._id.toString();
        
          if (!giorniMap.has(giorno)) giorniMap.set(giorno, new Map());
          const istruttoriMap = giorniMap.get(giorno);
        
          if (!istruttoriMap.has(istruttoreId)) istruttoriMap.set(istruttoreId, []);
          istruttoriMap.get(istruttoreId).push(l);
        });
        
        // Step 4: costruisci l’array finale ordinando le lezioni per orario
        const lezioniRaggruppate = [];
        
        giorniMap.forEach((istruttoriMap, giorno) => {
          const istruttoriArray = [];
          istruttoriMap.forEach((lezioniArray, istruttoreId) => {
            lezioniArray.sort((a, b) => {
              const [aHour, aMinute] = a.startTime.split(':').map(Number);
              const [bHour, bMinute] = b.startTime.split(':').map(Number);
              return aHour !== bHour ? aHour - bHour : aMinute - bMinute;
            });
            istruttoriArray.push({
              instructor: lezioniArray[0].instructor,
              lezioni: lezioniArray
            });
          });
          lezioniRaggruppate.push({
            day: giorno,
            instructors: istruttoriArray
          });
        });
        
        res.render('admin/adminComponents/lessons', { title: 'Admin - Visualizza Guide', guides: lezioniRaggruppate , istruttore, role: admin.role});
    } catch (error) {
        console.error('Errore durante il recupero delle guide:', error);
        return res.render('errorPage', {error: 'Errore durante il recupero delle guide' });
    }
});

router.get('/admin/lessons/:fromDate/:toDate', authenticateJWT, async (req, res) => {
    try {
        const istruttore = req.user.username;
        const [nome, cognome] = istruttore.split(" ");
        const admin = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});

        const lessonsQuery = {"day": { $gte: new Date(req.params.fromDate), $lte: new Date(req.params.toDate) }};
        const lessons = await LessonsDB.find(lessonsQuery).populate('instructor', 'nome cognome').populate('student', 'billingInfo email cell userName')

        const giorniMap = new Map();
  
        lessons.forEach(l => {
          const giorno = l.day.toISOString().split('T')[0].split('-').reverse().join('/');
          const istruttoreId = l.instructor._id.toString();
        
          if (!giorniMap.has(giorno)) giorniMap.set(giorno, new Map());
          const istruttoriMap = giorniMap.get(giorno);
        
          if (!istruttoriMap.has(istruttoreId)) istruttoriMap.set(istruttoreId, []);
          istruttoriMap.get(istruttoreId).push(l);
        });
        
        // Step 4: costruisci l’array finale ordinando le lezioni per orario
        const lezioniRaggruppate = [];
        
        giorniMap.forEach((istruttoriMap, giorno) => {
          const istruttoriArray = [];
          istruttoriMap.forEach((lezioniArray, istruttoreId) => {
            lezioniArray.sort((a, b) => {
              const [aHour, aMinute] = a.startTime.split(':').map(Number);
              const [bHour, bMinute] = b.startTime.split(':').map(Number);
              return aHour !== bHour ? aHour - bHour : aMinute - bMinute;
            });
            istruttoriArray.push({
              instructor: lezioniArray[0].instructor,
              lezioni: lezioniArray
            });
          });
          lezioniRaggruppate.push({
            day: giorno,
            instructors: istruttoriArray
          });
        });
        res.json({lessons: lezioniRaggruppate, role: admin.role, istruttore})
    } catch (error) {
        console.error(`Si è verificato un'errore nel caricamento delle lezioni: ${error}`);
        res.status(500).json({message: `Si è verificato un'errore durante il caricamento delle lezioni`})
    }
});

// router.get('/admin/users',authenticateJWT , async (req, res) => {
//     try {
//         const istruttore = req.user.username;
//         const [nome, cognome] = istruttore.split(" ");
//         const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
//         const utenti = await credentials.find();
//         const listaIstruttori = await Admin.find({}, 'nome cognome');
//         const istruttori = listaIstruttori.map(admin => `${admin.nome} ${admin.cognome}`);
//         const prices = await prezzoGuida.findOne();
//         res.render('admin/adminComponents/admin-users', { title: 'Admin - Visualizza Utenti', istruttore, utenti, istruttori, role, prices});
//     } catch (error) {
//         console.error('Errore durante il recupero degli utenti:', error);
//         return res.render('errorPage', {error: 'Errore durante il recupero degli utenti' });
//     }
// });
router.get('/admin/users', authenticateJWT , async (req, res) => {
    try {
        const istruttore = req.user.username;
        const [nome, cognome] = istruttore.split(" ");
        const { role } = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
        const students = await credentials.find();
        const instructors = await Admin.find({}, { 'nome': 1, 'cognome': 1 });
        const prices = await prezzoGuida.findOne();
        res.render('admin/adminComponents/students', { title: 'Admin - Visualizza Utenti', istruttore, students, instructors, role, prices});
    } catch (error) {
        console.error('Errore durante il recupero degli utenti:', error);
        return res.render('errorPage', {error: 'Errore durante il recupero degli utenti' });
    }
});
// router.get('/admin/user/:userId', authenticateJWT, async (req, res) => {
//     try {
//         const istruttore = req.user.username;
//         const [nome, cognome] = istruttore.split(" ");
//         const role = await Admin.findOne({ "nome": nome, "cognome": cognome }, { "role": 1 });
//         const userId = req.params.userId;
//         const user = await credentials.findOne({ "_id": userId });
//         res.render('admin/adminComponents/userPage', { role, user })
//     } catch (error) {
//         console.error('errore nella ricerca dell\'utente: ', error);
//         res.render('errorPage', {error: 'errore nella ricerca dell\'utente'});
//     }
// });
router.get('/admin/user/:userId', authenticateJWT, async (req, res) => {
    try {
        const istruttore = req.user.username;
        const [nome, cognome] = istruttore.split(" ");
        const role = await Admin.findOne({ "nome": nome, "cognome": cognome }, { "role": 1 });
        const userId = req.params.userId;
        const user = await credentials.findOne({ "_id": userId });
        const codes = await CodesDB.find({ user: userId });
        res.render('admin/adminComponents/student', { role, user, codes })
    } catch (error) {
        console.error('errore nella ricerca dell\'utente: ', error);
        res.render('errorPage', {error: 'errore nella ricerca dell\'utente'});
    }
});
router.post('/admin/updateUser', authenticateJWT, async (req, res) => {
    try {
        const dati = req.body;
        const billingInfo = [{
            nome: dati.nome,
            cognome: dati.cognome,
            codiceFiscale: dati.codiceFiscale,
            via: dati.via,
            nCivico: dati.nCivico,
            CAP: dati.CAP,
            citta: dati.citta,
            provincia: dati.provincia 
        }];
        const expFoglioRosa = new Date(dati.expFoglioRosa);
        await credentials.findOneAndUpdate({ "_id": dati.id }, { "email": dati.userEemail, "cell": dati.cell,"billingInfo": billingInfo, "licenseNumber": dati.licenseNumber , "expirationFoglioRosa": !isNaN(expFoglioRosa)? expFoglioRosa : null});
        res.redirect(`/admin/user/${dati.id}`);
    } catch (error) {
        console.error('errore nell\'aggiornamento dell\'utente', error);
        res.render('errorPage', { error: 'errore nell\'aggiornamento dell utente' });
    }
})
router.post('/admin/updateExam', authenticateJWT, async (req, res) => {
    try {
        const dati = req.body;
        const {action} = dati;
        switch (action) {
            case 'promuovi':
                await credentials.findOneAndUpdate(
                    { 
                      "_id": dati.userId, 
                      "exams": { $elemMatch: { "paid": true, "bocciato": false, $or: [ 
                        { "promosso": false }, 
                        { "promosso": { $exists: false } } 
                      ] } } 
                    },
                    { 
                        "archiviato": true,
                        $set: { "exams.$.promosso": true} 
                    }
                );
                break;
            case 'boccia':
                const user = await credentials.findOneAndUpdate(
                    { 
                      "_id": dati.userId, 
                      "exams": { $elemMatch: { "paid": true, "bocciato": false, $or: [ 
                        { "promosso": false }, 
                        { "promosso": { $exists: false } } 
                      ] } } 
                    },
                    { 
                      $set: { "exams.$.bocciato": true}
                    }
                );
                if(user.exams.length == 3){
                    await credentials.findOneAndUpdate(
                        {"_id": dati.userId},
                        {"archiviato": true}
                    );
                }
                await credentials.findOneAndUpdate(
                    {"_id": dati.userId},
                    {
                        $push: {
                            "exams": {
                              "paid": false,
                              "bocciato": false,
                              "promosso": false
                            }
                          }
                    }
                )
                break;
            case 'fissa data':
                await credentials.findOneAndUpdate(
                    { 
                      "_id": dati.userId, 
                      "exams": { $elemMatch: { "paid": true, "bocciato": false, $or: [ 
                        { "promosso": false }, 
                        { "promosso": { $exists: false } } 
                      ] } } 
                    },
                    { 
                        $set: { "exams.$.date": new Date(dati.examDate)} 
                    },
                    {new: true}
                );
                break;
            default:
                break;
        }
        res.status(200).json({success: true});
    } catch (error) {
        console.log(`Errore nell'update dell'esame, errore: ${error}`);
        res.status(500).json({success: false});
    }
});
// router.post('/createCode', authenticateJWT, async (req, res)=>{
//     try {
//         const code = (req.body.code).split(',');
//         const email = req.body.utenti;
//         const durata = req.body.durata;
//         const nCodes = durata == 'pacchetto' ? 10 : Number(req.body.totaleCodici);
//         const prices = await prezzoGuida.findOne();
//         let type = '';
//         let importo;
//         if(durata == 'esame'){
//             type = 'Esame di guida'
//             importo = prices.prezzoEsame;
//         }else if(durata == 'trascinamento'){
//             type = 'Trascinamento'
//             importo = 150;
//         }else if(durata == 'pacchetto'){
//             type = 'pacchetto'
//             importo = prices.prezzo;
//         }else{
//             type = 'Lezione di guida'
//             importo = (prices.prezzo * (durata/60));
//         }
//         await credentials.findOneAndUpdate(
//         {"email": email},
//         {$inc: {"totalCodes": nCodes}}
//     );
//     var today = new Date();
//     var day = today.getDate().toString().padStart(2, '0');
//     var month = (today.getMonth() + 1).toString().padStart(2, '0');
//     var year = today.getFullYear();
    
//     var date = day + '/' + month + '/' + year;
//     await credentials.findOneAndUpdate(
//         {
//             "email": email
//         },
//         {
//             $addToSet: {
//                 "fatturaDaFare": {"tipo": type, "data": date, "importo": (durata == 'pacchetto' ? prices.prezzoPacchettoFisico * (nCodes/10): importo * nCodes), "paymentUrl": 'Codice', "emessa": req.body.emettiFattura == 'on' ? false : true},
//             }
//         },
//         {new: true}
//     ); 
    
//     for(var i = 0; i < nCodes; i++){
//         await credentials.findOneAndUpdate(
//             {"email": email},
//             {$push: {"codicePagamento": { "codice": code[i], "data": date, "importo": importo}}},
//             { new: true }
//         );
//     }
//     if(req.body.emettiFattura == 'on'){
//         const finalPrice = durata == 'pacchetto' ? prices.prezzoPacchettoFisico * (nCodes/10): importo * nCodes;
//         const user = await credentials.findOne({"email": email})
//         const dati = {
//             codiceFiscaleCliente: user.billingInfo[0].codiceFiscale,
//             nomeCliente: user.billingInfo[0].cognome,
//             cognomeCliente: user.billingInfo[0].nome,
//             indirizzoSedeCliente: `${user.billingInfo[0].via} ${user.billingInfo[0].nCivico}`,
//             capSedeCliente: user.billingInfo[0].CAP,
//             comuneSedeCliente: user.billingInfo[0].citta,
//             provinciaSedeCliente: user.billingInfo[0].provincia,
//             nazioneSedeCliente: user.billingInfo[0].stato,
//             importo: finalPrice,
//             descrizione: type,
//             userName: user.userName
//         }
//         await createInvoice(dati);
//     }
// } catch (error) {
//     console.log(error)   
// }
//     res.redirect('/admin/users');
// });

router.post('/createCode', authenticateJWT, async (req, res)=>{
    try {
        const code = (req.body.code).split(',');
        const userId = req.body.utenti;
        const user = await credentials.findById(userId, { "createdAt": 1 });
        const durata = req.body.durata;
        const nCodes = durata == 'pacchetto' ? 10 : Number(req.body.totaleCodici);
        const prices = await prezzoGuida.findOne();
        let type = '';
        let importo;
        const lessonPrice = user.createdAt.getTime() >= (new Date(prices.userPriceFromDate.fromDate)).getTime() ? Number(userPriceFromDate.price) : prices.prezzo;
        if(durata == 'esame'){
            type = 'Esame di guida'
            importo = prices.prezzoEsame;
        }else if(durata == 'trascinamento'){
            type = 'Trascinamento'
            importo = prices.trascinamento;
        }else if(durata == 'pacchetto'){
            type = 'pacchetto'
            importo = prices.prezzo;
        }else{
            type = 'Lezione di guida'
            importo = (lessonPrice * (durata/60));
        }
        
    var today = new Date();
    var day = today.getDate().toString().padStart(2, '0');
    var month = (today.getMonth() + 1).toString().padStart(2, '0');
    var year = today.getFullYear();
    
    var date = day + '/' + month + '/' + year;
    await credentials.findByIdAndUpdate(userId,
        {
            $addToSet: {
                "fatturaDaFare": {"tipo": type, "data": date, "importo": Math.ceil((durata == 'pacchetto' ? prices.prezzoPacchettoFisico * (nCodes/10): importo * nCodes) * 100) / 100, "paymentUrl": 'Codice', "emessa": req.body.emettiFattura == 'on' ? false : true},
            }
        },
        {new: true}
    );
    
    const codes = [];
    for(var i = 0; i < nCodes; i++){
        codes.push({
            user: userId,
            code: code[i],
            amount: Math.ceil(importo * 100) / 100,
            active: true
        });
    }
    await CodesDB.insertMany(codes);
    if(req.body.emettiFattura == 'on'){
        const finalPrice = Math.ceil((durata == 'pacchetto' ? prices.prezzoPacchettoFisico * (nCodes/10) : importo * nCodes) * 100) / 100;
        const user = await credentials.findOne({"email": email})
        const dati = {
            codiceFiscaleCliente: user.billingInfo[0].codiceFiscale,
            nomeCliente: user.billingInfo[0].cognome,
            cognomeCliente: user.billingInfo[0].nome,
            indirizzoSedeCliente: `${user.billingInfo[0].via} ${user.billingInfo[0].nCivico}`,
            capSedeCliente: user.billingInfo[0].CAP,
            comuneSedeCliente: user.billingInfo[0].citta,
            provinciaSedeCliente: user.billingInfo[0].provincia,
            nazioneSedeCliente: user.billingInfo[0].stato,
            importo: finalPrice,
            descrizione: type,
            userName: user.userName
        }
        await createInvoice(dati);
    }
} catch (error) {
    console.log(error)   
}
    res.redirect('/admin/users');
});

router.post('/admin/archive', authenticateJWT, async (req, res) =>{
    try {
        const { email } = req.body;
        const user = await credentials.findOne({"email": email});
        if (user) {
            const nuovoArchiviato = !user.archiviato;
            await credentials.findOneAndUpdate(
                {"email": email},
                {$set: {"archiviato": nuovoArchiviato}}
            );
            res.status(200).json({success: true})
        } else {
            console.log('utente non trovato durante l\'archiviazione')
            res.status(404).json({success: false})
        }
    } catch (error) {
        console.error(`Si è verificato un'errore durante l'archiviazione: ${error}`);
        res.status(500).json({success: false});
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

router.post('/admin/perfezionamento', authenticateJWT, async (req, res) =>{
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
router.post('/admin/trascinamento', authenticateJWT, async (req, res) =>{
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
// router.get('/admin/guideSvolte/:username',authenticateJWT , async (req, res) => {
//     try {
//         const istruttore = req.user.username;
//         const [nome, cognome] = istruttore.split(" ");
//         const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
//         const userName = req.params.username.replace(':', '');
//         const guide = await credentials.findOne({"userName": userName}, {"lessonList": 1});
//         res.render('admin/adminComponents/resocontoGuide', { title: 'Admin - Guide Svolte', userName, guide, role});
//     } catch (error) {
//         console.error('Errore durante il recupero degli utenti:', error);
//         res.status(500).json({ message: 'Errore durante il recupero degli utenti' });
//     }
// });
router.get('/admin/lessons/:userId',authenticateJWT , async (req, res) => {
    try {
        const istruttore = req.user.username;
        const [nome, cognome] = istruttore.split(" ");
        const { role } = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
        const { userId } = req.params;
        const lessons = await LessonsDB.find({ "student": userId }).populate('instructor', 'nome cognome');
        res.render('admin/adminComponents/userLessons', { title: 'Admin - Guide Svolte', lessons, role});
    } catch (error) {
        console.error('Errore durante il recupero degli utenti:', error);
        res.status(500).json({ message: 'Errore durante la ricerca delle lezioni' });
    }
});

// router.get('/admin/addGuides',authenticateJWT , async (req, res) => {
//     const instructor = req.user.username;
//     const istruttori = await Admin.find({}, {nome : 1, cognome: 1, email: 1});
//     const [nome, cognome] = instructor.split(" ");
//     const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
//     const guides = await guide.find();
//     const allievi = await credentials.find({}, {"billingInfo" : 1, "email": 1});
//     res.render('admin/adminComponents/addGuides', { title: 'Admin - Crea Guide', instructor, guides, role, istruttori, allievi});
// });

router.get('/admin/addGuides',authenticateJWT , async (req, res) => {
    const instructor = req.user.username;
    const instructors = await Admin.find({}, {nome : 1, cognome: 1, email: 1, role: 1});
    const [nome, cognome] = instructor.split(" ");
    const { role } = instructors.find(i => i.nome === nome && i.cognome === cognome);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lessons = await LessonsDB.find({ "day": { $gte: today } }).populate('instructor', 'nome cognome');

    const giorniMap = new Map();
  
    lessons.forEach(l => {
      const giorno = new Date(l.day).toLocaleDateString('it-IT', {year: "numeric", month: "2-digit", day: "2-digit"});
      const istruttoreId = l.instructor._id.toString();
    
      if (!giorniMap.has(giorno)) giorniMap.set(giorno, new Map());
      const istruttoriMap = giorniMap.get(giorno);
    
      if (!istruttoriMap.has(istruttoreId)) istruttoriMap.set(istruttoreId, []);
      istruttoriMap.get(istruttoreId).push(l);
    });
    
    // Step 4: costruisci l’array finale ordinando le lezioni per orario
    const lezioniRaggruppate = [];
    
    giorniMap.forEach((istruttoriMap, giorno) => {
      const istruttoriArray = [];
      istruttoriMap.forEach((lezioniArray, istruttoreId) => {
        lezioniArray.sort((a, b) => {
          const [aHour, aMinute] = a.startTime.split(':').map(Number);
          const [bHour, bMinute] = b.startTime.split(':').map(Number);
          return aHour !== bHour ? aHour - bHour : aMinute - bMinute;
        });
        istruttoriArray.push({
          instructor: lezioniArray[0].instructor,
          lezioni: lezioniArray
        });
      });
      lezioniRaggruppate.push({
        day: giorno,
        instructors: istruttoriArray
      });
    });

    const students = (await credentials.find({ "archiviato": { $ne: true } }, { "billingInfo": 1 })).map(s => ({ "_id": s._id, "nome": s.billingInfo[0].nome, "cognome": s.billingInfo[0].cognome }));

    res.render('admin/adminComponents/createLessons', { title: 'Admin - Crea Guide', instructor, lessons: lezioniRaggruppate, role, instructors, students});
});

// router.post('/create-guide', authenticateJWT, async (req, res) => {
//     const { startHour, lessonsNumber, duration, locationLink} = req.body;
//     let istruttore;
//     const instructor = req.user.username;
//     const reservation = req.body.Reserved == ''? null : req.body.Reserved;
//     const [nome, cognome] = instructor.split(" ");
//     const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
//     if(role.role == 'Super'){
//         istruttore = req.body.instructor;
//     }else{
//         istruttore = req.user.username;
//     }
//     const days = req.body.day.split(", ");
//     try {
//         const pricePerHour = await prezzoGuida.findOne();
//         const price = (pricePerHour.prezzo/60) * duration;
//         for (const day of days) { // Itera su ogni data 
//             let oraDiInizio = startHour;
//             let schedule = [];
//             // Calcolo orari di inizio e fine delle lezioni
//             for (let i = 1; i <= lessonsNumber; i++) {
//                 var [startHours, startMinutes] = oraDiInizio.split(':').map(Number);
//                 let totalMinutes = startMinutes + Number(duration);
//                 let finalHours = Math.floor((startHours + Math.floor(totalMinutes / 60)) % 24);
//                 let finalMinutes = totalMinutes % 60;
//                 let endTime = `${finalHours.toString().padStart(2, '0')}:${finalMinutes.toString().padStart(2, '0')}`;
//                 let ora = `${oraDiInizio}-${endTime}`
//                 schedule.push({ hour: ora, price: price, student: null, reservedTo: reservation, locationLink: locationLink }); // assuming student is null initially
//                 oraDiInizio = endTime;
//             }
    
//             // Cerca la guida corrente nel database per l'istruttore e la data specificata
//             let existingGuide = await guide.findOne({ instructor: istruttore, 'book.day': day });
    
//             if (existingGuide) {
//                 // Se la guida esiste già per quella data, aggiungi la schedule
//                 await guide.updateOne(
//                     { instructor: istruttore, 'book.day': day },
//                     { $push: { 'book.$.schedule': { $each: schedule } } }
//                 );
//             } else {
//                 // Altrimenti, crea una nuova guida per quella data
//                 await guide.updateOne(
//                     { instructor: istruttore },
//                     { $push: { book: { day: day, schedule: schedule } } },
//                     { upsert: true }
//                 );
//             }
//         }
    
//         res.redirect('/admin/addGuides');
//     } catch (error) {
//         console.error('Errore durante la creazione della guida:', error);
//         res.status(500).json({ message: 'Errore durante la creazione della guida' });
//     }    
// });

router.post('/admin/createLesson', authenticateJWT, async (req, res) => {
    try{
        const { startHour, lessonsNumber, duration, locationLink, reserved} = req.body;

        const instructor = req.user.username;
        const [nome, cognome] = instructor.split(" ");
        const admin = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
        let istruttore = admin.role == 'Super' ? req.body.instructor : admin._id;

        const days = req.body.day.split(", ").map(d => new Date(d.split('/').reverse().join('-')));
        const lessons = [];
        const toHHMM = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

        for (const day of days) {
            let startTime = startHour;
            for (let i = 0; i < lessonsNumber; i++) {
                const startTimeInMinutes = (Number(startTime.split(':')[0]) * 60) + Number(startTime.split(':')[1]);
                const endTimeInMinutes = startTimeInMinutes + Number(duration);
            
                const lesson = {
                    instructor: istruttore,
                    day,
                    startTime: toHHMM(startTimeInMinutes),
                    endTime: toHHMM(endTimeInMinutes),
                    reservedTo: reserved,
                    locationLink,
                    duration
                };
            
                lessons.push(lesson);
                startTime = toHHMM(endTimeInMinutes);
            }
        }
        await LessonsDB.insertMany(lessons);
        res.redirect('/admin/addGuides');
    } catch (error) {
        console.error('Errore durante la creazione della guida:', error);
        res.status(500).json({ message: 'Errore durante la creazione della guida' });
    }    
});

// router.post('/deleteAllGuides', authenticateJWT, async (req, res) => {
//     try {
//         const { instructor, time } = req.body;
//         const { book } = await guide.findOne(
//             { 
//                 "instructor": instructor,
//                 "book": { 
//                     $elemMatch: { "day": time } 
//                 }
//             },
//             { "book": 1 }
//         );
//         for (const lesson of book[0].schedule) {
//             if((lesson.pending && ((new Date() - new Date(lesson.paymentCreatedAt) ) > (30 * 60 * 1000))) || lesson.completed) {
//                 return res.status(301).json({error: 'Non è possibile eliminare le lezioni perchè qualcuno ha iniziato la sessione di pagamento'});
//             }
//         }
//         await guide.findOneAndUpdate(
//             { "instructor": instructor },
//             { 
//                 $pull: { 
//                     "book": { "day": time } 
//                 } 
//             },
//             { 
//                 returnOriginal: false 
//             }
//         );
        
        
//         res.json('eliminate')
//     }catch(error){
//         console.error('Errore durante la rimozione della lezione di guida:', error);
//         res.status(500).send('Errore durante la rimozione della lezione di guida');
//     }
//     });
router.delete('/admin/lessons/:lessonId', authenticateJWT, async (req, res) => {
    try {
        const { lessonId } = req.params;
        
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

        await LessonsDB.findOneAndDelete({
          _id: lessonId,
          $or: [
            { "payment.status": { $nin: ["completed", "pending"] } },
            { "payment.status": "pending", "payment.paymentCreatedAt": { $lte: thirtyMinutesAgo } }
          ]
        });

        res.sendStatus(200);
    } catch (error) {
        console.error('Errore durante l\'eliminazione della lezione:', error);
        res.status(500).send('Errore durante l\'eliminazione della lezione!');
    }
});
router.delete('/admin/lessons/:instructorId/:date', authenticateJWT, async (req, res) => {
    try {
        const { instructorId, date } = req.params;
        const day = new Date(date);
        const now = new Date();
        const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

        await LessonsDB.deleteMany({
          instructor: instructorId,
          day: day,
          $or: [
            { "payment.status": { $nin: ["completed", "pending"] } },
            { "payment.status": "pending", "payment.paymentCreatedAt": { $lte: thirtyMinutesAgo } }
          ]
        });

        res.status(200);
    } catch (error) {
        console.error('Errore durante l\'eliminazione delle lezioni:', error);
        res.status(500).send('Errore durante l\'eliminazione delle lezioni!');
    }
});
// router.post('/adminRemovebooking', authenticateJWT, async (req, res) => {
//     try {
//         const { instructor, time } = req.body;

//         const day = time.split(' - ')[0];
//         const hour = time.split(' - ')[1];
        
//         const lesson = await guide.findOne(
//             { 
//                 "instructor": instructor,
//                 "book": { 
//                     $elemMatch: { 
//                         "day": day, 
//                         "schedule.hour": hour 
//                     } 
//                 }
//             },
//             { "book.schedule.$": 1 }
//         );
//         const scheduleObject = lesson.book[0].schedule.filter(el => el.hour == hour) || null;
//         if((scheduleObject.pending && (new Date() - new Date(scheduleObject.paymentCreatedAt) > (30 * 60 * 1000))) || scheduleObject.completed) {
//             return res.status(301).json({error: 'Non è possibile eliminare la lezione perchè qualcuno ha iniziato la sessione di pagamento'});
//         }
        

//         await guide.findOneAndUpdate({
//                 "instructor": instructor,
//                 "book": { 
//                     $elemMatch: { 
//                         "day": day
//                     } 
//                 }
//             },
//             { 
//                 $pull: { 
//                     "book.$.schedule": { "hour": hour } 
//                 }
//             },
//             { 
//                 returnOriginal: false 
//             }
//         );
//         await guide.updateOne(
//             { "instructor": instructor, "book.day": day, "book.schedule": { $size: 0 } },
//             { 
//                 $pull: { 
//                     "book": { "day": day } 
//                 }
//             }
//         );
        
//         res.sendStatus(200);
//     } catch (error) {
//         console.error('Errore durante la rimozione della lezione di guida:', error);
//         res.status(500).send('Errore durante la rimozione della lezione di guida');
//     }
// });

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
    const prices = await prezzoGuida.findOne();
    res.render('admin/adminComponents/prezzi', { title: 'Admin - Prezzi', role, prices});
});
router.post('/admin/editPrezzi', async (req, res)=>{
    try {
    const query = req.body;
    if(query.userPriceFromDate && query.userPriceFromDate.fromDate) query.userPriceFromDate.fromDate = new Date(query.userPriceFromDate.fromDate)
    await prezzoGuida.updateOne(query);
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

// router.get('/admin/oreIstruttori', authenticateJWT, async (req, res) => {
//     const instructor = req.user.username;
//     const [nome, cognome] = instructor.split(" ");
//     const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
//     const oreIstruttori = await Admin.find({}, {nome : 1, cognome : 1, email: 1, ore : 1});
//     res.render('admin/adminComponents/oreIstruttori', {title: 'Admin - Orari Istruttori', oreIstruttori, role});
// });

router.get('/admin/oreIstruttori', authenticateJWT, async (req, res) => {
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    res.render('admin/adminComponents/oreIstruttoriV2', {title: 'Admin - Orari Istruttori', role});
});

router.get('/admin/oreIstruttori/:fromDate/:toDate', authenticateJWT, async (req, res) => {
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    const { fromDate, toDate } = req.params;
    const lessons = await LessonsDB.find({
        "day": { $gte: new Date(fromDate), $lte: new Date(toDate) },
        "student": { $nin: [null, undefined] },
        // "payment.status": "completed"
    }, { duration: 1, instructor: 1 }).populate('instructor', 'nome cognome')
    const instructors = new Map()
    lessons.forEach(l => {
        const id = l.instructor._id.toString();
        const duration = instructors.get(id) || 0;
        instructors.set(id, duration + l.duration);
    });
    const instructorsHours = Array.from(instructors.entries()).map(([id, totalDuration]) => ({
        id,
        nome: lessons.find(l => l.instructor._id.toString() === id).instructor.nome,
        cognome: lessons.find(l => l.instructor._id.toString() === id).instructor.cognome,
        totalDuration
    }));
      
    res.status(200).json({ instructorsHours });
});

router.get('/admin/formatoEmail', authenticateJWT, async (req, res) => {
    const instructor = req.user.username;
    const [nome, cognome] = instructor.split(" ");
    const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
    const {content} = await formatoEmail.findOne({});
    res.render('admin/adminComponents/formatoEmail', {title: 'Admin - Formato Email', content, role});
});
router.post('/editFormatoEmail', authenticateJWT, async (req, res) => {
    const content = req.body.formatoField;
    await formatoEmail.findOneAndUpdate({}, {"content": content});
    res.redirect('/admin/formatoEmail');
});
router.get('/admin/pagamenti',authenticateJWT , async (req, res)=>{
    try {
        const instructor = req.user.username;
        const [nome, cognome] = instructor.split(" ");
        const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
        const id = req.query.id;
        const {fatturaDaFare} = await credentials.findOne({"_id": id});
        const pagamenti = fatturaDaFare;
        res.render('admin/payments/storicoPagamenti', {pagamenti, role});
    } catch (error) {
        console.log(error)
        res.render('errorPage', {error: `Utente non Trovato`});
    }
});
router.get('/admin/fatture/:username',authenticateJWT , async (req, res)=>{
    try {
        const instructor = req.user.username;
        const [nome, cognome] = instructor.split(" ");
        const role = await Admin.findOne({"nome": nome, "cognome": cognome}, {"role" : 1});
        const userName = req.params.username;
        const {fatturaDaFare} = await credentials.findOne({"userName": userName});
        const dati = fatturaDaFare;
        res.render('admin/adminComponents/fattureDaFare', {title: 'Admin - Fatture Da Emettere', dati, userName, role});
    } catch (error) {
        res.render('errorPage', {error: `Utente non Trovato`});
    }
});
// router.post('/admin/spostaLezione', authenticateJWT, async (req, res) => {
//     try {
//         const duration = req.body.duration/60;
//         const student = req.body.student;

//         const oldDate = req.body.date;
//         const oldHour = req.body.hour;
//         const oldInstructor = req.body.istruttore;

//         await Admin.findOneAndUpdate({ "nome": oldInstructor.split(' ')[0], "cognome": oldInstructor.split(' ')[1], "ore.data": oldDate }, { $inc: { "ore.$.totOreGiorno": -duration } });

//         const newDate = req.body.newLesson.split(' - ')[0];
//         const newHour = req.body.newLesson.split(' - ')[1];
//         const newInstructor = req.body.newLesson.split(' - ')[2];

//         const existingOrario = await Admin.updateOne({ "nome": newInstructor.split(' ')[0], "cognome": newInstructor.split(' ')[1], "ore.data": newDate },
//             { $inc: { "ore.$[elem].totOreGiorno": duration } }, { arrayFilters: [{ "elem.data": newDate }], upsert: false });
//         if (existingOrario.matchedCount == 0) {
//             await Admin.updateOne({ "nome": newInstructor.split(' ')[0], "cognome": newInstructor.split(' ')[1] },
//                 { $addToSet: { "ore": { data: newDate, totOreGiorno: duration } } }, { upsert: true });
//         }

//         await guide.findOneAndUpdate({ "instructor": oldInstructor, "book.day": oldDate, "book.schedule.hour": oldHour, "book.schedule.student": student },
//             { $set: { "book.$[outer].schedule.$[inner].student": null, "book.$[outer].schedule.$[inner].completed": false, "book.$[outer].schedule.$[inner].pending": false } },
//             { arrayFilters: [{ "outer.day": oldDate }, { "inner.hour": oldHour, "inner.student": student }] });

//         await guide.findOneAndUpdate({ "instructor": newInstructor, "book.day": newDate, "book.schedule.hour": newHour, "book.schedule.student": null },
//             { $set: { "book.$[outer].schedule.$[inner].student": student, "book.$[outer].schedule.$[inner].completed": true, "book.$[outer].schedule.$[inner].pending": true } },
//             { arrayFilters: [{ "outer.day": newDate }, { "inner.hour": newHour, "inner.student": null }] });

//         await credentials.findOneAndUpdate({ "userName": student },
//             { $pull: { "lessonList": { "istruttore": oldInstructor, "giorno": oldDate, "ora": oldHour, "duration": duration } } })
//         await credentials.findOneAndUpdate({ "userName": student },
//             { $addToSet: { "lessonList": { "istruttore": newInstructor, "giorno": newDate, "ora": newHour, "duration": duration } } }, { new: true });
        
//         res.redirect('/admin/guides');
//     } catch (error) {
//         console.error(error);
//         res.render('errorPage', { error: `errore nello spostamento della guida` });
//     }
// });

router.post('/admin/spostaLezione', authenticateJWT, async (req, res) => {
    try {
        const { oldLessonId, newLessonId } = req.body;
        const oldLesson = await LessonsDB.findById(oldLessonId);
        const newLesson = await LessonsDB.findById(newLessonId);

    if (!oldLesson || !newLesson) return res.render('errorPage', { error: "Lezione non trovata" });

    if (newLesson.payment?.status === "completed") return res.render('errorPage', { error: "La lezione scelta è già stata prenotata" });
    
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const updatedLesson = await LessonsDB.findOneAndUpdate(
        {
            _id: newLessonId,
            student: null,
            $or: [
                { "payment.status": { $exists: false } },
                { "payment.status": null },
                {
                    "payment.status": "pending",
                    "payment.paymentCreatedAt": { $lt: thirtyMinutesAgo } // > 30 min fa
                }
            ]
        }, { "student": oldLesson.student, "payment.status": "completed"});

        if(!updatedLesson) return res.render('errorPage', { error: "La lezione scelta sta già venendo prenotata!" });

        await LessonsDB.findByIdAndUpdate(oldLessonId, {
            student: null,
            "payment.status": null,
            "payment.paymentCreatedAt": null,
            "payment.amount": null
        });
        res.redirect('/admin/guides');
    } catch (error) {
        console.error(error);
        res.render('errorPage', { error: `errore nello spostamento della guida` });
    }
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
    try {
        let dati = req.body;
        await createInvoice(dati)

        res.redirect(`/admin/fatture/:${dati.userName}`);
    } catch (error) {
        console.log(`errore creazione fattura ${error}`);
        res.render('errorPage', { error: `errore creazione fattura` });
    }
});

module.exports = router;
