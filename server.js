const express = require('express');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const CSV_FILE_PATH = path.join(DATA_DIR, 'rate-per-duration.csv');
const swaggerDocument = YAML.load('./swagger.yaml');

// --- In-Memory Cache for Loan Rates ---
let loanRates = [];

// --- Loan Rate Caching Logic ---
const refreshLoanRateCache = () => {
  console.log('Refreshing loan rate cache...');
  const results = [];
  if (fs.existsSync(CSV_FILE_PATH)) {
    fs.createReadStream(CSV_FILE_PATH)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        loanRates = results;
        console.log('✅ Loan rate cache successfully refreshed.');
      });
  } else {
    console.warn('⚠️ No rate-per-duration.csv found. Loan rate API will be empty.');
    loanRates = [];
  }
};

// --- Multer Configuration for CSV Upload ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, DATA_DIR);
  },
  filename: function (req, file, cb) {
    cb(null, 'rate-per-duration.csv'); // Always overwrite with the same filename
  },
});
const upload = multer({ storage: storage });

// --- Helper Functions ---
const formatCurrency = (value) => (value || 0).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' });

// --- Middlewares ---
app.use(cors());
app.use(express.json());

// --- API Documentation Route ---
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// --- API Routes ---
app.get('/', (req, res) => res.json({ message: "Welcome to the Strady.imo API!" }));

app.get('/api/loan-rates', (req, res) => {
  res.json(loanRates);
});

app.post('/api/upload-rates', upload.single('ratesFile'), (req, res) => {
  console.log('New CSV file uploaded.');
  refreshLoanRateCache();
  res.status(200).json({ message: 'File uploaded and rates refreshed successfully.' });
});

app.post('/api/generate-pdf', (req, res) => {
  const data = req.body;
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=Strady-imo-Summary.pdf');
  doc.pipe(res);

  doc.fontSize(20).font('Helvetica-Bold').text('Strady.imo Project Summary', { align: 'center' });
  doc.moveDown(2);

  doc.fontSize(16).font('Helvetica-Bold').text('Acquisition & Renovation');
  doc.fontSize(12).font('Helvetica').text(`Property Price: ${formatCurrency(data.propertyPrice)}`);
  const renovationCost = data.renovationItems.reduce((total, item) => {
    const COST_PER_SQM = { light: 250, medium: 750, heavy: 1500 };
    return total + (item.surface * COST_PER_SQM[item.intensity]);
  }, 0);
  doc.text(`Total Renovation Cost: ${formatCurrency(renovationCost)}`);
  doc.moveDown();

  const registrationTaxRate = data.region === 'flanders' ? 0.03 : 0.125;
  const registrationTax = data.propertyPrice * registrationTaxRate;
  const notaryFees = data.propertyPrice * 0.015 + 1200;
  const totalProjectCost = data.propertyPrice + registrationTax + notaryFees + renovationCost;
  const initialCashOutlay = data.personalContribution + registrationTax + notaryFees;
  doc.fontSize(16).font('Helvetica-Bold').text('Financing Overview');
  doc.fontSize(12).font('Helvetica').text(`Total Project Cost: ${formatCurrency(totalProjectCost)}`);
  doc.text(`Initial Cash Outlay: ${formatCurrency(initialCashOutlay)}`);
  doc.moveDown();
  
  const grossAnnualIncome = ((data.monthlyRent || 0) + (data.otherMonthlyIncome || 0)) * 12;
  const effectiveGrossIncome = grossAnnualIncome * (1 - (data.vacancyRate || 0) / 100);
  const totalAnnualExpenses = (data.propertyTax || 0) + (data.insurance || 0) + (data.maintenance || 0) + ((data.coOwnershipFees || 0) * 12);
  const netOperatingIncome = effectiveGrossIncome - totalAnnualExpenses;
  doc.fontSize(16).font('Helvetica-Bold').text('Rental Performance');
  doc.fontSize(12).font('Helvetica').text(`Net Operating Income (NOI): ${formatCurrency(netOperatingIncome)} / year`);
  doc.moveDown();

  doc.end();
});

// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }
  refreshLoanRateCache();
});