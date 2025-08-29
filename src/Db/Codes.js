const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const connect = mongoose.connect('mongodb+srv://antoniodamelio:nOm8iKw7hfJcWFhD@cluster0.oyegnnb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

connect.then(() =>{
    console.log('Codes Database connected successfully');
})
.catch(() =>{
    console.log('Codes Database cannot be connected');
});

const codeSchema = new mongoose.Schema({
    user: { type: Schema.Types.ObjectId, ref: 'users' },
    code: { type: String },
    amount: { type: Number },
    active: { type: Boolean },
    usedAt: { type: Date }
}, { timestamps: true });

const codes = new mongoose.model('codes', codeSchema);

module.exports = codes;