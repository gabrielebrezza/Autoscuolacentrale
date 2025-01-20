const { create } = require('xmlbuilder2');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const numeroFattura = require("../Db/NumeroFattura");
const credentials = require('../Db/User');
const storicoFatture = require('../Db/StoricoFatture');

const sendEmail = require('./emailsUtils');

async function createInvoice(dati) {
    const {numero} = await numeroFattura.findOne();
    dati.progressivoInvio = `g00${numero}`;
    dati.numeroDocumento = `g00${numero}`;
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0'); 
    const mm = String(today.getMonth() + 1).padStart(2, '0'); 
    const yyyy = today.getFullYear(); 
    const data = `${yyyy}-${mm}-${dd}`;
    // Costruisci il documento XML della fattura elettronica
    const xml = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('p:FatturaElettronica')
    .att('xmlns:ds', 'http://www.w3.org/2000/09/xmldsig#')
    .att('xmlns:p', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2')
    .att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
    .att('versione', 'FPR12')
    .att('xsi:schemaLocation', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd')        .ele('FatturaElettronicaHeader')
    .ele('DatiTrasmissione')
    .ele('IdTrasmittente')
    .ele('IdPaese').txt('IT').up()
    .ele('IdCodice').txt('06498290011').up()
    .up()
    .ele('ProgressivoInvio').txt(dati.progressivoInvio).up()
    .ele('FormatoTrasmissione').txt('FPR12').up()
    .ele('CodiceDestinatario').txt('0000000').up()
    .ele('ContattiTrasmittente')
    .ele('Telefono').txt('0116507136').up()
    .ele('Email').txt('autoscuola.centrale@libero.it').up()
    .up()
    .up()
    .ele('CedentePrestatore')
    .ele('DatiAnagrafici')
    .ele('IdFiscaleIVA')
    .ele('IdPaese').txt('IT').up()
    .ele('IdCodice').txt('06498290011').up()
    .up()
    .ele('CodiceFiscale').txt('DMLNTN67S12L738X').up()
    .ele('Anagrafica')
    .ele('Denominazione').txt("D'Amelio Antonio").up()
    .up()
    .ele('RegimeFiscale').txt('RF01').up()
    .up()
    .ele('Sede')
    .ele('Indirizzo').txt('Corso Guglielmo Marconi, 33').up()
    .ele('CAP').txt('10125').up()
    .ele('Comune').txt('TORINO').up()
    .ele('Provincia').txt('TO').up()
    .ele('Nazione').txt('IT').up()
    .up()
    .up()
    .ele('CessionarioCommittente')
    .ele('DatiAnagrafici')
    .ele('CodiceFiscale').txt((dati.codiceFiscaleCliente).replace(/\s+/g, ' ').trim().toUpperCase()).up()
    .ele('Anagrafica')
    .ele('Nome').txt((dati.nomeCliente).replace(/\s+/g, ' ').trim()).up()
    .ele('Cognome').txt((dati.cognomeCliente).replace(/\s+/g, ' ').trim()).up()
    .up()
    .up()
    .ele('Sede')
    .ele('Indirizzo').txt((dati.indirizzoSedeCliente).replace(/\s+/g, ' ').trim()).up()
    .ele('CAP').txt((dati.capSedeCliente).replace(/\s+/g, ' ').trim()).up()
    .ele('Comune').txt((dati.comuneSedeCliente).replace(/\s+/g, ' ').trim()).up()
    .ele('Provincia').txt((dati.provinciaSedeCliente).replace(/\s+/g, ' ').trim()).up()
    .ele('Nazione').txt((dati.nazioneSedeCliente).replace(/\s+/g, ' ').trim()).up()
    .up()
    .up()
    .up()
    .ele('FatturaElettronicaBody')
    .ele('DatiGenerali')
    .ele('DatiGeneraliDocumento')
    .ele('TipoDocumento').txt('TD01').up()
    .ele('Divisa').txt('EUR').up()
    .ele('Data').txt(data).up()
    .ele('Numero').txt(dati.numeroDocumento).up()
    .ele('ImportoTotaleDocumento').txt(Number(dati.importo).toFixed(2)).up()
    .up()
    .up()
    .ele('DatiBeniServizi')
    .ele('DettaglioLinee')
    .ele('NumeroLinea').txt('1').up()
    .ele('Descrizione').txt(dati.descrizione).up()
    .ele('PrezzoUnitario').txt(Number(dati.importo/1.22).toFixed(2)).up()
    .ele('PrezzoTotale').txt(Number(dati.importo/1.22).toFixed(2)).up()
    .ele('AliquotaIVA').txt('22.00').up()
    .up()
    .ele('DatiRiepilogo')
    .ele('AliquotaIVA').txt('22.00').up()
    .ele('ImponibileImporto').txt(Number(dati.importo/1.22).toFixed(2)).up()
    .ele('Imposta').txt(Number(dati.importo-(dati.importo/1.22)).toFixed(2)).up()
    .ele('EsigibilitaIVA').txt('I').up()
    .up()
    .up()
    .ele('DatiPagamento')
    .ele('CondizioniPagamento').txt('TP02').up()
    .ele('DettaglioPagamento')
    .ele('ModalitaPagamento').txt('MP08').up()
    .ele('ImportoPagamento').txt(Number(dati.importo).toFixed(2))
    .up()
    .up()
    .up();
    
    const xmlString = xml.end({ prettyPrint: true });
    const nomeBaseFile = `${'IT'}${'06498290011'}_${dati.progressivoInvio}.xml`;
    let nomeFile = nomeBaseFile;
    
    let counter = 1;
    
    while (fs.existsSync(path.join('fatture', nomeFile))) {
        nomeFile = `${nomeBaseFile}_${counter}.xml`;
        counter++;
    }
    fs.writeFile(path.join('fatture', nomeFile), xmlString, async (err) => {
        if (err) {
            console.error('Errore durante il salvataggio del file:', err);
            return {success: false}
        } else {
            const dataFatturazione = data.split('-').reverse().join('/');
            await credentials.findOneAndUpdate(
                {
                    "userName": dati.userName,
                    "fatturaDaFare": {
                        $elemMatch: {
                            "data": dataFatturazione,
                            "tipo": dati.descrizione,
                            "importo": dati.importo,
                            "emessa": false
                        }
                    }
                },
                {
                    $set: {
                        "fatturaDaFare.$.emessa": true
                    }
                }
            );
            
            const doc = new PDFDocument();
            
            
            doc.fontSize(16).text('Autoscuola Centrale', { align: 'left' });
            doc.text('Corso Marconi 33 - 10125 Torino (TO)', { align: 'left' });
            doc.text('P.IVA 06498290011', { align: 'left' });
            doc.text('Fattura di Cortesia', { align: 'right' });
            doc.moveDown();
            
            doc.moveDown();
            doc.rect(50, doc.y, 500, 1).fill('#000');
            doc.moveDown();
            
            doc.text('CLIENTE', { underline: true });
            doc.rect(50, doc.y + 10, 500, 200).stroke();
            doc.moveDown();
            doc.text(`Nome: ${dati.nomeCliente} ${dati.cognomeCliente}`, 60, doc.y + 20);
            doc.text(`Numero: ${dati.progressivoInvio}`, 60, doc.y + 20);
            doc.text(`Indirizzo: ${dati.indirizzoSedeCliente} ${dati.capSedeCliente} ${dati.comuneSedeCliente} (${dati.provinciaSedeCliente})`,  60, doc.y + 20);
            doc.text(`Data: ${data}`, 60, doc.y + 20);
            doc.text(`C.Fiscale: ${dati.codiceFiscaleCliente}`, 60, doc.y + 20);
            doc.moveDown();
            
            // Box per dettagli della fattura
            doc.text('Dettagli Fattura', { underline: true });
            doc.moveDown();
            doc.text('Data             Descrizione                            QTA     EURO');
            doc.text(`${data}     ${dati.descrizione}                           ${Number(dati.importo/1.22).toFixed(2)}€`);
            doc.moveDown();
            doc.fillColor("#FF0000").text(`Fattura di cortesia  non valida ai fini fiscali.`);
            doc.text(`La fattura è stata emessa in formato elettronico ed è consultabile nel cassetto fiscale`);
            doc.fillColor("#000000");
            doc.moveDown();
            doc.text('Modalità di pagamento', { underline: true });
            doc.moveDown();
            doc.text('TOTALE IMPONIBILE: ', { continued: true });
            doc.text(`${Number(dati.importo/1.22).toFixed(2)} €`);
            doc.text('IVA 22%: ', { continued: true });
            doc.text(`${(Number((dati.importo/1.22)) * 0.22).toFixed(2)} €`);
            doc.text('TOTALE FATTURA: ', { continued: true });
            doc.text(`${Number(dati.importo).toFixed(2)} €`);
            doc.moveDown();
            
            doc.pipe(fs.createWriteStream(`./fatture/fattura_${dati.nomeCliente}_${dati.cognomeCliente}.pdf`));
            doc.end();
            
            const {email} = await credentials.findOne({"userName": dati.userName});
            const subject = 'Fattura di cortesia';
            const text = `Gentile ${dati.cognomeCliente} ${dati.nomeCliente} ti inviamo la fattura di cortesia per il pagamento che hai effettuato.`;
            const filename = `./fatture/fattura_${dati.nomeCliente}_${dati.cognomeCliente}.pdf`;
            try{
                const result = await sendEmail(email, subject, text, filename);
                console.log('fattura cortesia');
                console.log(result);
            }catch(error){
                console.log('errore email fattura cortesia: ', error);
            }
            
            const numero = parseInt((dati.progressivoInvio).replace(/\D/g, ''), 10);
            
            const nuovaFattura = new storicoFatture({
                numero: numero,
                importo: dati.importo,
                user:`${dati.nomeCliente} ${dati.cognomeCliente}`,
                data: dataFatturazione,
                nomeFile: nomeFile,
            });
            await nuovaFattura.save()
            .catch((errore) => {
                console.error(`Si è verificato un errore durante l'aggiunta della fattura:`, errore);
                return {success: false}
            });
            
            await numeroFattura.updateOne({$inc: {"numero": 1}});
            return;
        }
    });
}

module.exports = {createInvoice}