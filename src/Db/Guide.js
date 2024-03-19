const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb://localhost/Autoscuolacentrale');

connect.then(() =>{
    console.log('BookingGuide Database connected successfully');
})
.catch(() =>{
    console.log('BookingGuide Database cannot be connected');
});

const guideSchema = new mongoose.Schema({
    instructor:{
        type: String,
        required: true
    },
    book:[
            {
                dateHour: {
                    type: String,
                    required: true
                },

                student:{
                    type: String,
                    required: false
                }
            }
        ]
});

const guide = new mongoose.model('prenotazioniGuide', guideSchema);

module.exports = guide;