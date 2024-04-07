const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

connect.then(() =>{
    console.log('numeroFattura Database connected successfully');
})
.catch(() =>{
    console.log('numeroFattura Database cannot be connected ');
});

const numeroFatturaSchema = new mongoose.Schema({
    numero: {
        type: Number,
        required: true
    }
});

const numeroFattura = new mongoose.model('numeroFattura', numeroFatturaSchema);

module.exports = numeroFattura;