const express = require('express');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

AWS.config.update({ region: 'us-east-1' });
const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const app = express();

const USER_POOL_ID = process.env.USER_POOL_ID || 'PLACEHOLDER';
const CLIENT_ID = process.env.CLIENT_ID || 'PLACEHOLDER';
const REGION = 'us-east-1';

const client = jwksClient({
    jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`
});

function getKey(header, callback) {
    client.getSigningKey(header.kid, (err, key) => {
        const signingKey = key.publicKey || key.rsaPublicKey;
        callback(null, signingKey);
    });
}

function verifyToken(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'No token' });
    
    jwt.verify(token, getKey, {
        audience: CLIENT_ID,
        issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
        algorithms: ['RS256']
    }, (err, decoded) => {
        if (err) return res.status(401).json({ message: 'Invalid token' });
        req.user = decoded;
        next();
    });
}

app.use(express.json());
app.use(express.static('public'));

app.get('/api/appointments', verifyToken, async (req, res) => {
    try {
        const result = await dynamodb.scan({ TableName: 'Appointments' }).promise();
        res.json({ appointments: result.Items });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching appointments' });
    }
});

app.put('/api/appointments/:id', verifyToken, async (req, res) => {
    try {
        const params = {
            FunctionName: 'UpdateAppointmentStatus',
            Payload: JSON.stringify({
                body: { appointmentId: req.params.id, status: req.body.status }
            })
        };
        const result = await lambda.invoke(params).promise();
        const response = JSON.parse(result.Payload);
        res.status(response.statusCode).json(JSON.parse(response.body));
    } catch (error) {
        res.status(500).json({ message: 'Error' });
    }
});

app.get('/health', (req, res) => res.json({ status: 'healthy' }));

app.listen(3000, '0.0.0.0', () => console.log('Server on port 3000'));
