const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb://localhost/Autoscuolacentrale');

connect.then(() =>{
    console.log('Admins Database connected successfully');
})
.catch(() =>{
    console.log('Admins Database cannot be connected ');
});

const AdminSchema = new mongoose.Schema({
    userName:{
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    }
});

const adminCredentials = new mongoose.model('Admin', AdminSchema);

module.exports = adminCredentials;