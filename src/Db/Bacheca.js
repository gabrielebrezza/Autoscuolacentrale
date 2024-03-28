const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb://localhost/Autoscuolacentrale');

connect.then(() =>{
    console.log('Bachecas Database connected successfully');
})
.catch(() =>{
    console.log('Bachecas Database cannot be connected ');
});

const BachecaSchema = new mongoose.Schema({
    content: {
        type: String,
        required: true
    },
    editedBy:[ 
        {
            type: String,
            required: true
        }
    ]
});

const bacheca = new mongoose.model('Bachecas', BachecaSchema);

module.exports = bacheca;