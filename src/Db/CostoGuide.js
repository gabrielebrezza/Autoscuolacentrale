const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

connect.then(() =>{
    console.log('Prezzo Database connected successfully');
})
.catch(() =>{
    console.log('Prezzo Database cannot be connected ');
});

const prezzoGuideSchema = new mongoose.Schema({
    prezzo: {
        type: Number,
        required: true
    },
    userPriceFromDate: {
        fromDate: {
            type: Date,
            required: true
        },
        price: {
            type: Number,
            required: true
        }
    },
    reschedulingFee: {
        type: Number
    },
    trascinamento: {
        type: Number
    },
    prezzoEsame: {
        type: Number,
        required: true
    },
    prezzoPacchetto: {
        type: Number,
        required: true
    },
    prezzoPacchettoFisico: {
        type: Number,
        required: true
    }
});

const prezzoGuida = new mongoose.model('prezzoGuida', prezzoGuideSchema);

module.exports = prezzoGuida;