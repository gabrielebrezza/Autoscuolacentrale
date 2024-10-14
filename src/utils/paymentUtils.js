const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const paypal = require('paypal-rest-sdk');

const credentials = require('./../Db/User');
const admin = require('./../Db/Admin');
const guide = require('./../Db/Guide');
const formatoEmail = require('./../Db/formatoEmail');

const sendEmail = require('./../utils/emailsUtils');

async function addFattura(student, paymentUrl, type, price){
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0'); 
    const mm = String(today.getMonth() + 1).padStart(2, '0'); 
    const yyyy = today.getFullYear(); 
    const data = `${dd}/${mm}/${yyyy}`;
    await credentials.findOneAndUpdate(
        {
            "userName": student,
            "fatturaDaFare.paymentUrl": { $ne: paymentUrl }
        },
        {
            $addToSet: {
                "fatturaDaFare": {"tipo": type, "data": data, "importo": price, "paymentUrl": paymentUrl, "emessa": false},
            }
        },
        {new: true}
    ); 
}

//PAYPAL CHECKOUT
paypal.configure({
    mode: process.env.PAYPAL_MODE,
    client_id: process.env.PAYPAL_PUBLIC,
    client_secret: process.env.PAYPAL_SECRET
});

async function createPaypal(price, userName, returnPath, custom = {}){
    const create_payment_json = {
        intent: "sale",
        payer: {
            payment_method: "paypal"
        },
        redirect_urls: {
            return_url: `${process.env.SERVER_URL}${returnPath}?paymentMethod=paypal`,
            cancel_url: `${process.env.SERVER_URL}/cancel`,
        },
        transactions: [
            {
                item_list: {
                    items: [
                        {
                            name: 'Servizio Autoscuola',
                            sku: 1,
                            price: price,
                            currency: "EUR",
                            quantity: 1
                        }
                    ]
                },
                amount: {
                    currency: "EUR",
                    total: price
                },
                custom: JSON.stringify(custom),
                description: 'Servizio Autoscuola'
            }
        ]
    }; 
    return new Promise((resolve, reject) => {
        paypal.payment.create(create_payment_json, async (error, payment) => {
            if (error) {
                reject(error);
            } else {
                for (let i = 0; i < payment.links.length; i++) {
                    if (payment.links[i].rel === "approval_url") {
                        await credentials.findOneAndUpdate({ "userName": userName }, { "paymentId": payment.id });
                        resolve(payment.links[i].href);
                    }
                }
            }
        });
    });
}

async function retrivePayPal(payerId, paymentId, type){
    return new Promise((resolve, reject) => {
        paypal.payment.execute(paymentId, {payer_id: payerId}, async (error, payment) =>{
            if(error){
                reject(error);
            }else{
                const transactionId = payment.transactions[0].related_resources[0].sale.id;
                const paymentUrl = `https://paypal.com/activity/payment/${transactionId}`;
                const custom = JSON.parse(payment.transactions[0].custom);
                const user = await credentials.findOne({"paymentId": paymentId});
                await addFattura(user.userName, paymentUrl, type, payment.transactions[0].amount.total);
                resolve({userId: user._id, custom});
            }
        });
    });
}

//SATISPAY CHECKOUT
function generateDigest(body) {
    const hash = crypto.createHash('sha256');
    hash.update(body);
    return `SHA-256=${hash.digest('base64')}`;
}

function signString(stringToSign) {
    const privateKey = fs.readFileSync('src/keys/satispay/private.pem', 'utf8');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(stringToSign);
    return signer.sign(privateKey, 'base64');
}

async function createSatispay(price, id, returnPath, custom = {}) {
    const payload = {
        flow: 'MATCH_CODE',
        amount_unit: price * 100,
        currency: 'EUR',
        callback_url: `${process.env.SERVER_URL}/satispay-callback?payment_id={uuid}`,
        redirect_url: `${process.env.SERVER_URL}${returnPath}?paymentMethod=satispay&id=${id}`,
        metadata: custom
    };

    const body = JSON.stringify(payload);
    const date = new Date().toUTCString();
    const requestTarget = `(request-target): post /g_business/v1/payments`;
    const host = `host: ${process.env.SATISPAY_API_URL}`;
    const digest = generateDigest(body);

    const stringToSign = `${requestTarget}\n${host}\ndate: ${date}\ndigest: ${digest}`;

    const signature = signString(stringToSign);

    const authorizationHeader = `Signature keyId="${process.env.SATISPAY_KEYID}", algorithm="rsa-sha256", headers="(request-target) host date digest", signature="${signature}"`;

    try {
        const response = await axios.post(`https://${process.env.SATISPAY_API_URL}/g_business/v1/payments`, body, {
            headers: {
                'Content-Type': 'application/json',
                'Host': process.env.SATISPAY_API_URL,
                'Date': date,
                'Digest': digest,
                'Authorization': authorizationHeader
            }
        });
        await credentials.findOneAndUpdate({ "_id": id }, { "paymentId": response.data.id });
        return response.data.redirect_url;
    } catch (error) {
        console.error('Error creating payment:', error.response ? error.response.data : error.message);
    }
}

async function retriveSatispay(paymentId, username, type) {
  const url = `https://${process.env.SATISPAY_API_URL}/g_business/v1/payments/${paymentId}`;
  const date = new Date().toUTCString();
  const requestTarget = `(request-target): get /g_business/v1/payments/${paymentId}`;
  const host = `host: ${process.env.SATISPAY_API_URL}`;
  
  // Corpo della richiesta vuoto per GET
  const body = '';
  const digest = generateDigest(body);
  
  const stringToSign = `${requestTarget}\n${host}\ndate: ${date}\ndigest: ${digest}`;
  const signature = signString(stringToSign);
  
  const authorizationHeader = `Signature keyId="${process.env.SATISPAY_KEYID}", algorithm="rsa-sha256", headers="(request-target) host date digest", signature="${signature}"`;

  try {
      const response = await axios.get(url, {
          headers: {
              'Content-Type': 'application/json',
              'Host': process.env.SATISPAY_API_URL,
              'Date': date,
              'Digest': digest,
              'Authorization': authorizationHeader
          }
      });
      const { status, metadata, amount_unit } = response.data;
      const user = await credentials.findOne({'userName': username});
      const paymentUrl = `https://dashboard.satispay.com/dashboard/transactions/${user.paymentId}`;
      console.log(`satispay id: ${paymentId}, user: ${username}, type: ${type}, response: ${response}`);
      await addFattura(username, paymentUrl, type, amount_unit/100);
      return { status, custom: metadata};
  } catch (error) {
      console.error('Error checking payment status:', error.response ? error.response.data : error.message);
      throw error;
  }
}

//CODE CHECKOUT
async function checkCode(code, price, username, type) {
    const result = await credentials.findOne({"userName": username, "codicePagamento": {$elemMatch: {"codice": code,"importo": price}}});
    await credentials.updateOne({"userName": username},{ $pull: { "codicePagamento": { "codice": code, "importo": price }}});
    if(!!result) await addFattura(username, 'Codice', type, price);
    return !!result;
}

//SETPAID FUNCTIONS
async function setLessonPaid(username, userId, custom){
    const guideRecord = await guide.findOne({
        "instructor": custom.instructor,
        "book._id": custom.bookId,
        "book.schedule._id": custom.scheduleId,
    });
    
    const lezione = guideRecord.book.find(b => b._id.toString() == custom.bookId.toString()).schedule.find(s => s._id.toString() == custom.scheduleId.toString());
    
    const paymentStartTime = new Date(lezione.paymentCreatedAt);
    if (lezione.completed) return { expired: true };
    const currentTime = new Date();
    const expirationTime = 30 * 60 * 1000;
  
    if (currentTime - paymentStartTime > expirationTime) {
        return {expired: true};
    }
    await guide.findOneAndUpdate(
        { "instructor": custom.instructor, "book._id": custom.bookId, "book.schedule._id": custom.scheduleId, "book.schedule.student": null },
        { $set: { "book.$[outer].schedule.$[inner].student": username, "book.$[outer].schedule.$[inner].completed": true }},
        {arrayFilters: [{ "outer._id": custom.bookId }, { "inner._id": custom.scheduleId }]});

    const {email, billingInfo} = await credentials.findOne({"_id": userId});
    let subject = 'Prenotazione effettuata per lezione di guida';
    let {content} = await formatoEmail.findOne();
    content = content.replace(/\(NOME\)/g, billingInfo[0].nome)
    .replace(/\(COGNOME\)/g, billingInfo[0].cognome)
    .replace(/\(DATA\)/g, custom.day)
    .replace(/\(DAORA\)/g, custom.hour.split('-')[0])
    .replace(/\(AORA\)/g, custom.hour.split('-')[1])
    .replace(/\(LINKPOSIZIONE\)/g, custom.location);
    try{
        const result = await sendEmail(email, subject, content);
        console.log(result);
    }catch(error){
        console.log('errore: ', error);
    }

    const duration = (Math.floor(new Date(`1970-01-01T${custom.hour.split('-')[1]}:00`) - new Date(`1970-01-01T${custom.hour.split('-')[0]}:00`))/60000)/60;
    
    const [nome, cognome] = custom.instructor.split(' ');
    const existingOrario = await admin.updateOne({ "nome": nome, "cognome": cognome, "ore.data": custom.day },
        {$inc: { "ore.$[elem].totOreGiorno": duration }}, {arrayFilters: [{ "elem.data": custom.day }], upsert: false });
    if(existingOrario.matchedCount == 0){
        await admin.updateOne({ "nome": nome, "cognome": cognome },
            {$addToSet: { "ore": { data: custom.day, totOreGiorno: duration }}},{ upsert: true });
    }

    await credentials.findOneAndUpdate({"_id": userId},
        {$addToSet: {"lessonList": {"istruttore": custom.instructor, "giorno": custom.day, "ora": custom.hour, "duration": duration}}},{new: true});
    return {expired: false};
}

async function setSpostaGuidaPaid(userId, custom) {
    const [oldName, oldSurName] = custom.oldInstructor.split(" ");
        await admin.findOneAndUpdate({"nome": oldName,"cognome": oldSurName,"ore.data": custom.oldDate}, {$inc: {"ore.$.totOreGiorno": -custom.duration}});

        const [newName, newSurName] = custom.newInstructor.split(" ");
        const existingOrario = await admin.updateOne({ "nome": newName, "cognome": newSurName, "ore.data": custom.newDate },
            {$inc: { "ore.$[elem].totOreGiorno": custom.duration }}, {arrayFilters: [{ "elem.data": custom.newDate }], upsert: false });
        if(existingOrario.matchedCount == 0){
            await admin.updateOne({ "nome": newName, "cognome": newSurName },
                {$addToSet: { "ore": { data: custom.newDate, totOreGiorno: custom.duration }}},{ upsert: true });
        }

        await guide.findOneAndUpdate({"instructor": custom.oldInstructor, "book.day": custom.oldDate, "book.schedule.hour": custom.oldHour,"book.schedule.student": custom.student},
            { $set: { "book.$[outer].schedule.$[inner].student": null, "book.$[outer].schedule.$[inner].completed": false, "book.$[outer].schedule.$[inner].pending": false }},
            {arrayFilters: [{ "outer.day": custom.oldDate },{ "inner.hour": custom.oldHour, "inner.student": custom.student }]});

        await guide.findOneAndUpdate({"instructor": custom.newInstructor, "book.day": custom.newDate, "book.schedule.hour": custom.newHour, "book.schedule.student": null},
            { $set: { "book.$[outer].schedule.$[inner].student": custom.student, "book.$[outer].schedule.$[inner].completed": true, "book.$[outer].schedule.$[inner].pending": true }},
                {arrayFilters: [{ "outer.day": custom.newDate }, { "inner.hour": custom.newHour, "inner.student": null }]});

        await credentials.findOneAndUpdate({"_id": userId},
            {$pull: {"lessonList": {"istruttore": custom.oldInstructor, "giorno": custom.oldDate, "ora": custom.oldHour, "duration": custom.duration}}})
        await credentials.findOneAndUpdate({"_id": userId},
            {$addToSet: {"lessonList": {"istruttore": custom.newInstructor, "giorno": custom.newDate, "ora": custom.newHour, "duration": custom.duration}}}, {new: true});
}

async function setExamPaid(userId){
    await credentials.findOneAndUpdate({ "_id": userId },{ $set: { "exams.$[elem].paid": true } },
        {
            arrayFilters: [{ "elem": { $exists: true } }],
            sort: { "exams._id": -1 },
            new: true
        }
    );
    await credentials.findOneAndUpdate({ "_id": userId }, { $push: { "exams": { "paid": false, "bocciato": false }}});
}

module.exports = {createPaypal, retrivePayPal, createSatispay, retriveSatispay, checkCode, setLessonPaid, setSpostaGuidaPaid, setExamPaid };