const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const collection = require('./User');

const app = express();

app.use(express.json());

app.use(express.urlencoded({extended: false}));

app.set('view engine', 'ejs');

app.use(express.static('public'));

app.get('/', (req, res) =>{
    res.render('login_signup');
});

//Register user
app.post("/signup", async (req, res) =>{
    const data = {
        userName: req.body.username,
        password: req.body.password
    }
    //check if the user already exist
    const existingUser = await collection.findOne({userName: data.userName});
    if(existingUser){
        res.send('<h1>Esiste già un account con questo nome</h1>');
    }else{
        //encrypting password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(data.password, saltRounds);

        data.password = hashedPassword;

        const userData = await collection.insertMany(data);
        console.log('nuovo utente registrato: ', data.userName);
        res.redirect('/');
    }
});

app.post('/login', async (req, res) =>{

    try{
        const check = await collection.findOne({userName: req.body.username});
        if(!check){
            res.send('this username does not exist');
        }

        //check the password
        const isPasswordMatch = await bcrypt.compare(req.body.password, check.password);
        if(isPasswordMatch){
            
            console.log('nuovo utente loggato: ', req.body.username);
            res.redirect(`/profile/:${req.body.username}`);
        }else{
            res.send('password errata');
        }
    }catch{
        res.send('Credenziali sbagliate ');
    }
})

app.get('/profile/:username', async (req, res)=>{

    const nome = req.params.username;
    res.send(`benvenuto ${nome}`);
});

const port = 5000;
app.listen(port, () =>{
    console.log('Server running on Port: ' + port);
})