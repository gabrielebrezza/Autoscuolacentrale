const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

connect.then(() =>{
    console.log('StoricoFattures Database connected successfully');
})
.catch(() =>{
    console.log('StoricoFattures Database cannot be connected ');
});

const storicoFattureSchema = new mongoose.Schema({
    numero: {
        type: Number,
        required: true
    },
    data: {
        type: String,
        required: true
    },
    importo: {
        type: Number,
        required: true
    },
    user:{
        type: String,
        required: false
    },
    fileCortesia: {
        type: String,
        required: false
    },
    nomeFile: {
        type: String,
        required: true
    }
});

const storicoFatture = new mongoose.model('storicoFatture', storicoFattureSchema);

module.exports = storicoFatture;