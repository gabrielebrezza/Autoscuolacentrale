const mongoose = require('mongoose');
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

connect.then(() =>{
    console.log('BookingGuide Database connected successfully');
})
.catch(() =>{
    console.log('BookingGuide Database cannot be connected');
});

const guideSchema = new mongoose.Schema({
    instructor: {
        type: String,
        required: true
    },
    book: [
        {
            day: {
                type: String,
                required: true
            },
            schedule: [
                {
                    hour: {
                        type: String,
                        required: true
                    },
                    price: {
                        type: Number,
                        required: true
                    },
                    locationLink: {
                        type: String,
                        required: false
                    },
                    reservedTo: {
                        type: String,
                        required: false
                    },
                    student: {
                        type: String,
                        required: false
                    }
                }
            ]
        }
    ]
});

const guide = new mongoose.model('prenotazioniGuide', guideSchema);

module.exports = guide;