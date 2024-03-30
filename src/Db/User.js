const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb://localhost/Autoscuolacentrale');

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
    }
});

const credentials = new mongoose.model('users', LoginSchema);

module.exports = credentials;