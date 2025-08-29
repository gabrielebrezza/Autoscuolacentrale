const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

connect.then(() =>{
    console.log('BookingGuide Database connected successfully');
})
.catch(() =>{
    console.log('BookingGuide Database cannot be connected');
});

const guideSchema = new mongoose.Schema({
    instructor: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'users', required: false },
    day: {
        type: Date,
        required: true
    },
    startTime: {
        type: String,
        required: true
    },
    endTime: {
        type: String,
        required: true
    },
    duration: {
        type: Number,
        required: true
    },
    locationLink: {
        type: String
    },
    reservedTo: [
        {
            type: String
        }
    ],
    payment: {
        amount: {
            type: Number
        },
        paymentCreatedAt: {
            type: Date
        },
        paymentId: {
            type: String
        },
        status: {
            type: String,
            enum: ['pending', 'completed', null]
        }
    },
    createdAt: {
        type: Date
    }
}, { timestamps: true });

const lessons = new mongoose.model('lessons', guideSchema);

module.exports = lessons;