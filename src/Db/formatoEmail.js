const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb://localhost/Autoscuolacentrale');

connect.then(() =>{
    console.log('formatoEmails Database connected successfully');
})
.catch(() =>{
    console.log('formatoEmails Database cannot be connected ');
});

const formatoEmailSchema = new mongoose.Schema({
    content: {
        type: String,
        required: true
    }
});

const formatoEmail = new mongoose.model('formatoEmail', formatoEmailSchema);

module.exports = formatoEmail;