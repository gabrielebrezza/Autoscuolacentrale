const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

connect.then(() =>{
    console.log('Users Database connected successfully');
})
.catch(() =>{
    console.log('Users Database cannot be connected ');
});

const LoginSchema = new mongoose.Schema({
    email:{
        type: String,
        required: true
    },
    cell:{
        type: String,
        required: true
    },
    userName:{
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    exams: [
        {
            paid: {
                type: Boolean,
                required: true
            },
            bocciato: {
                type: Boolean,
                required: true
            }
        }
    ],
    exclude: [
        {
            instructor: {
                type: String,
                required: false
            }
        }
    ],
    OTP: {
        type: String,
        required: false
    },
    approved: {
        type: Boolean,
        required: true 
    },
    billingInfo:[
        {
            nome: {
                type:String,
                required: false
            },
            cognome: {
                type:String,
                required: false
            },
            codiceFiscale: {
                type:String,
                required: false
            },
            via: {
                type:String,
                required: false
            },
            nCivico: {
                type:String,
                required: false
            },
            CAP: {
                type:String,
                required: false
            },
            citta: {
                type:String,
                required: false
            },
            provincia: {
                type: String,
                required: false
            },
            stato: {
                type: String,
                required: false
            }
        }
    ],
    fatturaDaFare: [
        {
            tipo: {
                type: String,
                required: false
            },
            data: {
                type: String,
                required: false
            },
            importo: {
                type: Number,
                required: false
            },
            emessa: {
                type: Boolean,
                required: false
            }
        }
    ],
    lessonList: [
        {
            istruttore: {
                type: String,
                required: false
            },
            giorno: {
                type: String,
                required: false
            },
            ora: {
                type: String,
                required: false
            },
            duration:{
                type: Number,
                required: false
            }
        }
    ],
    resetPasswordCode: {
        type: String,
        required: false
    },
    totalCodes: {
        type: Number,
        required:false
    },
    codicePagamento: [
        {
            codice: {
                type: String,
                required: false
            },
            data: {
                type: String,
                required: false
            },
            importo: {
                type: Number,
                required: false
            }
        }
    ],
    archiviato: {
        type: Boolean,
        default: false
    }
});

const credentials = new mongoose.model('users', LoginSchema);

module.exports = credentials;