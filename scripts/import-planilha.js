#!/usr/bin/env node
// Importa os clientes da planilha sistemacontroledelascont.xlsx para o banco.
// Uso: node scripts/import-planilha.js
// Roda do diretório raiz do projeto (C:\Delas no Windows).
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = require('../src/db');

const clientes = [
  { cnpj: '25.388.802/0001-41', nome: 'MERCEARIA IRMAOS FERREIRA PAIVA LTDA' },
  { cnpj: '23.883.234/0001-20', nome: 'BISCOITERIA RIBEIRO E SILVA LTDA' },
  { cnpj: '58.372.131/0001-80', nome: 'SILVA & GOMES SERVICOS MEDICOS LTDA' },
  { cnpj: '34.755.803/0001-78', nome: 'IVECAL VISTORIAS VEICULAR LTDA' },
  { cnpj: '71.064.695/0001-13', nome: 'CASA DE VELAS UNIVERSO & ARMARINHOS LTDA' },
  { cnpj: '59.699.897/0001-36', nome: 'CRISCARLOS TERRAPLENAGEM LTDA' },
  { cnpj: '49.800.503/0001-30', nome: 'GOOD ENERGY MANUTENCAO E EQUIPAMENTOS LTDA' },
  { cnpj: '60.848.342/0001-98', nome: 'PRISCILA MARQUES DA SILVA' },
  { cnpj: '65.289.266/0001-41', nome: 'JOSE BARBOSA DO CARMO JUNIOR' },
  { cnpj: '14.749.171/0001-22', nome: 'DIONES & RODRIGO CONSTRUTORA LTDA' },
  { cnpj: '07.899.843/0001-10', nome: 'COMERCIO E CONSTRUTORA E CONSERVADORA EWBANQUENSE LTDA' },
  { cnpj: '55.911.639/0001-10', nome: 'CASA DE CARNES JUNIOR AUGUSTO LTDA' },
  { cnpj: '53.600.109/0001-26', nome: 'ESPACO NAILS THALITA CARVALHO LTDA' },
  { cnpj: '65.134.219/0001-29', nome: 'LOUCAS POR MODA PRECO UNICO LTDA' },
  { cnpj: '66.199.488/0001-36', nome: 'EMPREENDIMENTO IMOBILIARIO IRMAOS FERREIRA PAIVA LTDA' },
  { cnpj: '65.947.726/0001-81', nome: 'DIEGUINHO LANCHES LTDA' },
  { cnpj: '67.625.398/0001-22', nome: 'MDE VISTORIAS VEICULAR LTDA' },
  { cnpj: '07.333.837/0001-00', nome: 'L.E.V ATIVIDADES FISICAS LTDA' },
  { cnpj: '67.913.387/0001-48', nome: 'RF ASSESSORIA GERENCIAL LTDA' },
  { cnpj: '03.121.306/0001-94', nome: 'RESTAURANTE GONZAGAO LTDA' },
  { cnpj: '08.745.347/0001-75', nome: 'ELI OLIVEIRA DA SILVA' },
  { cnpj: '26.247.338/0001-36', nome: 'EME PAPELARIA LTDA' },
  { cnpj: '18.133.455/0001-40', nome: 'TARCISIO VIEIRA DA SILVA ME' },
  { cnpj: '16.765.254/0001-30', nome: 'SOS PAPELARIA LTDA' },
  { cnpj: '19.405.907/0001-69', nome: 'CASTRO & PAIVA PRESTACAO DE SERVICOS MEDICOS LTDA' },
  { cnpj: '10.400.313/0001-90', nome: 'SABORES SORVETERIA & BOMBONIERE LTDA' },
  { cnpj: '26.290.230/0001-26', nome: 'WILMA DE BARROS FERREIRA - ME' },
  { cnpj: '20.490.052/0001-09', nome: 'YAGO COIMBRA ALVES BARRETO MARQUES ME' },
  { cnpj: '36.009.597/0001-82', nome: 'COLISEU GOURMET LTDA' },
  { cnpj: '41.744.444/0001-19', nome: 'LUCIANA APARECIDA MENDES DA SILVA' },
  { cnpj: '34.067.388/0001-60', nome: 'SABRINA RODRIGUES LOPES' },
  { cnpj: '33.913.140/0001-00', nome: 'MADEIREIRA SAO GERALDO BARBACENA LTDA' },
  { cnpj: '10.637.227/0001-04', nome: 'COMERCIO E LANCHONETE DA VOVO LTDA' },
  { cnpj: '44.744.155/0001-08', nome: 'SIOMARA DIAS PINHEIRO' },
  { cnpj: '16.934.881/0001-58', nome: 'ELIANI APARECIDA REZENDE' },
  { cnpj: '40.175.784/0001-03', nome: 'DOCE COM LACOS - CONFEITARIA LTDA' },
  { cnpj: '33.314.226/0001-16', nome: 'MARCELLE DA SILVA GALVOND' },
  { cnpj: '36.347.810/0001-66', nome: 'ESTEFANIA GINIANE BARRETO' },
  { cnpj: '19.183.402/0001-05', nome: 'ROSANA CRISTINA FIRMO BARBOSA' },
  { cnpj: '49.783.872/0001-62', nome: 'PAULO ROGERIO IUNES MARTINS ME' },
  { cnpj: '36.347.810/0002-47', nome: 'ESTEFANIA GINIANE BARRETO ME' },
  { cnpj: '33.809.232/0001-44', nome: 'ESPACO NATHALIA MENDES LTDA' },
  { cnpj: '62.211.980/0001-29', nome: 'RESTAURANTE SABOR A MAIS SANTOS DUMONT LTDA' },
  { cnpj: '64.059.150/0001-53', nome: 'EKI PECAS ACESSORIOS E MECANICA LTDA' },
  { cnpj: '64.059.150/0002-34', nome: 'EKI PECAS ACESSORIOS E MECANICA LTDA (FILIAL)' },
  { cnpj: '40.175.784/0002-94', nome: 'DOCE COM LACOS - CONFEITARIA LTDA (FILIAL)' },
  { cnpj: '66.394.107/0001-70', nome: 'RESTAURANTE EDESIO ALVIM PEDROSA LTDA' },
  { cnpj: '52.776.542/0001-54', nome: 'LOUCAS POR MODA KIDS LTDA' },
  { cnpj: '64.688.170/0001-93', nome: 'BRUNO EUGENIO RIBEIRO' },
];

const insCompany = db.prepare(
  `INSERT INTO companies (name, cnpj, regime, status, honorario)
   VALUES (?, ?, 'Simples Nacional', 'ativa', 0)`
);
const insPage = db.prepare('INSERT INTO pages (company_id) VALUES (?)');

let inserted = 0, skipped = 0;
for (const c of clientes) {
  const exists = db.prepare('SELECT id FROM companies WHERE cnpj = ?').get(c.cnpj);
  if (exists) { skipped++; continue; }
  const { lastInsertRowid } = insCompany.run(c.nome, c.cnpj);
  insPage.run(Number(lastInsertRowid));
  inserted++;
}

console.log(`✔ Importação concluída: ${inserted} inseridas, ${skipped} já existiam.`);
