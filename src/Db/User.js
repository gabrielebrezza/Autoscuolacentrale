const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

connect.then(() => {
        console.log('Users Database connected successfully');
    })
    .catch(() => {
        console.log('Users Database cannot be connected ');
    });

const LoginSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true
    },
    cell: {
        type: String,
        required: true
    },
    userName: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    licenseNumber: {
        type: String,
        trim: true,
        uppercase: true,
        required: false
    },
    expirationFoglioRosa: {
        type: Date,
        required: false
    },
    exams: [{
        paid: {
            type: Boolean,
            required: true
        },
        date: {
            type: Date,
            required: false,
            default: null
        },
        bocciato: {
            type: Boolean,
            required: true
        },
        promosso: {
            type: Boolean,
            required: false,
            default: false
        }
    }],
    exclude: [{
        instructor: {
            type: String,
            required: false
        }
    }],
    OTP: {
        type: String,
        required: false
    },
    approved: {
        type: Boolean,
        required: true
    },
    billingInfo: [{
        nome: {
            type: String,
            trim: true,
            lowercase: true,
            required: false
        },
        cognome: {
            type: String,
            trim: true,
            lowercase: true,
            required: false
        },
        codiceFiscale: {
            type: String,
            required: false,
            trim: true,
            uppercase: true
        },
        via: {
            type: String,
            trim: true,
            lowercase: true,
            required: false
        },
        nCivico: {
            type: String,
            trim: true,
            lowercase: true,
            required: false
        },
        CAP: {
            type: String,
            trim: true,
            required: false
        },
        citta: {
            type: String,
            trim: true,
            lowercase: true,
            required: false
        },
        provincia: {
            type: String,
            trim: true,
            required: false
        },
        stato: {
            type: String,
            required: false
        }
    }],
    fatturaDaFare: [{
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
        paymentUrl: {
            type: String,
            required: false
        },
        emessa: {
            type: Boolean,
            required: false
        }
    }],
    lessonList: [{
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
        duration: {
            type: Number,
            required: false
        }
    }],
    resetPasswordCode: {
        type: String,
        required: false
    },
    totalCodes: {
        type: Number,
        required: false
    },
    codicePagamento: [{
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
        },
        active: {
            type: Boolean,
            required: true,
            default: true
        }
    }],
    perfezionamento: {
        type: Boolean,
        default: false
    },
    trascinamento: {
        attivo: {
            type: Boolean,
            default: false
        },
        pagato: {
            type: Boolean,
            default: false
        }
    },
    paymentId: {
        type: String,
        required: false
    },
    archiviato: {
        type: Boolean,
        default: false
    }
});

const credentials = new mongoose.model('users', LoginSchema);

module.exports = credentials;