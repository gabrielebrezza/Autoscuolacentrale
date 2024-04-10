const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

connect.then(() =>{
    console.log('Admins Database connected successfully');
})
.catch(() =>{
    console.log('Admins Database cannot be connected ');
});

const AdminSchema = new mongoose.Schema({
    email:{
        type: String,
        required: true
    },
    nome:{
        type: String,
        required: true
    },
    cognome:{
        type: String,
        required: true
    },
    otp: {
        type: String,
        required: false
    },
    password: {
        type: String,
        required: true
    },
    ore: [
        {        
            totOreGiorno:{
                type: Number,
                required: false
            },
            data:{
                type: String,
                required: false
            }
        }
    ],
    approved: {
        type: Boolean,
        required: true
    },
    role: {
        type: String,
        required: true
    }
});

const adminCredentials = new mongoose.model('Admin', AdminSchema);

module.exports = adminCredentials;