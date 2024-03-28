const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb://localhost/Autoscuolacentrale');

connect.then(() =>{
    console.log('Users Database connected successfully');
})
.catch(() =>{
    console.log('Users Database cannot be connected ');
});

const LoginSchema = new mongoose.Schema({
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
    ]
});

const credentials = new mongoose.model('users', LoginSchema);

module.exports = credentials;