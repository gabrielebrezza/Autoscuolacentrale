const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

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