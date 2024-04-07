const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

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