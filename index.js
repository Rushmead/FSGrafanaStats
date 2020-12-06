// const ftp = require('basic-ftp');
require('dotenv').config();
const axios = require('axios');
const parseString = require('xml2js').parseString;
const {InfluxDB, Point} = require('@influxdata/influxdb-client')

const url = process.env.INFLUX_URL;
const token = process.env.INFLUX_TOKEN;
const writeApi = new InfluxDB({url, token}).getWriteApi(process.env.INFLUX_ORG, process.env.INFLUX_BUCKET, 'ns');
const baseURL = process.env.API_URL;
const code = process.env.API_CODE;

function newDataPoint(name, values, tags = {}){
    let point = new Point(name);
    point.timestamp(new Date());
    Object.keys(values).forEach((k) => {
        let type = values[k].type;
        let value = values[k].value;
        let vName = values[k].name;
        if(type === 'int'){
            point.intField(vName, value);
        } else if(type === 'float'){
            point.floatField(vName, value);
        } else if(type === 'boolean'){
            point.booleanField(vName, value);
        } else {
            point.stringField(vName, value);
        }
    })
    Object.keys(tags).forEach((tagName) => {
        point.tag(tagName, tags[tagName])
    });
    return point;
}

async function getDataEndpoint(endpoint, file = '') {
    return axios.get(`${baseURL}${endpoint}?code=${code}${file.length > 0 ? '&file=' + file : ''}`);
}

async function asyncParseString(string){
    return new Promise((resolve, reject) => {
        parseString(string, (err, result) => {
            if(err){
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

async function getAndParseData(endpoint, file = ''){
    try {
        let response = await getDataEndpoint(endpoint, file);
        let json = await asyncParseString(response.data);
        return json;
    } catch(error){
        console.error(error);
        return null;
    }
    return null;
}

async function doFinanceStats(allStatData){
    let totalLoan = allStatData.careerSavegame.statistics[0].loan[0];
    let loanAnnualInterestRate = allStatData.careerSavegame.statistics[0].loanAnnualInterestRate[0];
    let npcWages = -allStatData.economy.financeStatsHistory[0].financeStats[0].wagePayment[0];
    let totalMoney = Number(allStatData.server['$']['money']);
    let harvestIncomes = allStatData.economy.financeStatsHistory[0].financeStats.map((s) => Number(s.harvestIncome[0]));
    let fiveDayAverage = harvestIncomes.reduce((a, b) => a + b, 0) / harvestIncomes.length || 0;
    let leasingCosts = allStatData.economy.financeStatsHistory[0].financeStats[0].vehicleLeasingCost[0];
    let soldBales = allStatData.economy.financeStatsHistory[0].financeStats[0].soldBales[0];
    let dataPoint = newDataPoint('economy', [
        {
            name: 'totalLoan',
            value: totalLoan,
            type: 'int'
        },
        {
            name: 'loanAnnualInterestRate',
            value: loanAnnualInterestRate,
            type: 'int'
        },
        {
            name: 'npcWages',
            value: npcWages,
            type: 'float'
        },
        {
            name: 'totalMoney',
            value: totalMoney,
            type: 'float'
        },
        {
            name: 'fiveDayAverage',
            value: fiveDayAverage,
            type: 'float'
        },
        {
            name: 'leasingCosts',
            value: leasingCosts,
            type: 'float'
        },
        {
            name: 'soldBales',
            value: soldBales,
            type: 'float'
        }
    ]);
    writeApi.writePoint(dataPoint);
}

async function doResourceStats(allStatData){
    let cowCount = 0;
    let cowStats = allStatData.vehicles.onCreateLoadedObject.find((f) => f['$'] && f['$'].saveId && f['$'].saveId === 'Animals_cow');
    if(cowStats !== undefined){
        cowCount = cowStats['$'].numAnimals0;
    }
    let cowsBred = allStatData.careerSavegame.statistics[0].breedCowsCount[0];
    let storageLocations = allStatData.vehicles.onCreateLoadedObject.filter((f) => f['$'] && f['$'].saveId && f['$'].saveId.startsWith("Storage_storage"));
    let dataPoints = storageLocations.map((storageLocation) => {
        let values = storageLocation.node.map((n) => {
            return {
                name: n['$'].fillType,
                value: n['$'].fillLevel,
                type: 'float'
            }
        });
        return newDataPoint('storage', values, {location: storageLocation['$'].saveId});
    });
    let resourceDataPoint = newDataPoint('resources', [
        {
            name: 'cowCount',
            value: cowCount,
            type: 'int'
        },
        {
            name: 'cowsBred',
            value: cowsBred,
            type: 'int'
        }
    ]);
    dataPoints.push(resourceDataPoint);
    writeApi.writePoints(dataPoints);
}

async function doVehicleStats(allStatData){
    let tractors = allStatData.server.Vehicles[0].Vehicle.filter((v) => v['$'] && v['$'].category === "tractors").length;
    let players = allStatData.server.Slots[0]['$'].numUsed;
    let vehicles = allStatData.server.Vehicles[0].Vehicle.filter((v) => v['$'] && v['$'].fillLevels);
    let dataPoints = vehicles.map((vehicle) => {
        let fillTypes = vehicle['$'].fillTypes.split(" ");
        let fillLevels = vehicle['$'].fillLevels.split(" ");
        let values = fillTypes.map((n, i) => {
            return {
                name: n,
                value: fillLevels[i],
                type: 'float'
            }
        });
        if(vehicle['$'].controller){
            values.push({
                name: 'controller',
                value: vehicle['$'].controller,
                type: 'string'
            });
        }
        return newDataPoint('vehicle', values, {category: vehicle['$'].category, name: vehicle['$'].name});
    });
    let tractorToPlayerRatio = 0;
    if(tractors != 0 && players != 0)
        tractorToPlayerRatio = (tractors / players);
    let vehicleDataPoint = newDataPoint('vehicles', [
        {
            name: 'tractorCount',
            value: tractors,
            type: 'int'
        },
        {
            name: 'playerCount',
            value: players,
            type: 'int'
        },
        {
            name: 'tractorToPlayer',
            value: tractorToPlayerRatio,
            type: 'float'
        }
    ]);
    dataPoints.push(vehicleDataPoint);
    writeApi.writePoints(dataPoints);
}

async function doGeneralStats(allStatData){
    let npcsDoingWork = allStatData.server.Vehicles[0].Vehicle.filter((v) => v['$'] && v['$'].isHired && v['$'].isHired === "true").length;
    let playTime = allStatData.careerSavegame.statistics[0].playTime[0];
    let soldBales = allStatData.careerSavegame.statistics[0].baleCount[0];
    let generalDataPoint = newDataPoint('general', [
        {
            name: 'npcsDoingWork',
            value: npcsDoingWork,
            type: 'int'
        },
        {
            name: 'playTime',
            value: playTime,
            type: 'int'
        },
        {
            name: 'soldBales',
            value: soldBales,
            type: 'int'
        }
    ]);
    writeApi.writePoint(generalDataPoint);
}

async function getData(){
    let object = await Promise.all([{file: 'careerSavegame', endpoint: 'dedicated-server-savegame.html'}, {file: 'economy', endpoint: 'dedicated-server-savegame.html'}, {endpoint: 'dedicated-server-savegame.html', file: 'vehicles'}, {file: '', endpoint: 'dedicated-server-stats.xml'}].map((s) => getAndParseData(s.endpoint, s.file)));
    let careerSavegame = {...object[0].careerSavegame};
    let economy = {...object[1].economy};
    let vehicles = {...object[2].careerVehicles};
    let server = {...object[3].Server};
    let megaObject = {careerSavegame, economy, vehicles, server};
    doFinanceStats(megaObject);
    doResourceStats(megaObject);
    doVehicleStats(megaObject);
    doGeneralStats(megaObject);
    // console.log(loanAnnualInterestRate);
    // fs.writeFileSync('output.json', JSON.stringify({careerSavegame, economy, vehicles, server}))
    // console.log();
}

// async function readFromFile(){
//     let object = {};
//     let promises = [];
//     promises.push(new Promise((resolve, reject) => {
//         fs.readFile(path.join(temp, 'careerSavegame.xml'), function(err, data){
//             parseString(data, function(err, result){
//                 object['career'] = result;
//                 resolve();
//             })
//         });
//     }));
//     promises.push(new Promise((resolve, reject) => {
//         fs.readFile(path.join(temp, 'economy.xml'), function(err, data){
//             parseString(data, function(err, result){
//                 object['economy'] = result;
//                 resolve();
//             })
//         });
//     }));
//     promises.push(new Promise((resolve, reject) => {
//         fs.readFile(path.join(temp, 'vehicles.xml'), function(err, data){
//             parseString(data, function(err, result){
//                 object['vehicles'] = result;
//                 resolve();
//             })
//         });
//     }));
//     promises.push(new Promise((resolve, reject) => {
//         fs.readFile(path.join(temp, 'fruit_density_growthState.xml'), function(err, data){
//             parseString(data, function(err, result){
//                 object['growthState'] = result;
//                 resolve();
//             })
//         });
//     }));
//     await Promise.all(promises);
//     return object;
// }

// function flatten(input, prefix = ''){
//     let r = {};
//     Object.keys(input).forEach((key) => {
//         if(typeof input[key] === 'object'){
//            r = {...r, ...flatten(input[key], prefix + "_" + key)}
//         } else {
//             r[prefix + "_" + key] = input[key]
//         }
//     })
//     return r;
// }



// async function saveData(){
//     let data = await readFromFile();
//     let siloData = {};
//     data.vehicles.careerVehicles.onCreateLoadedObject.find((f) => f['$'].saveId === "Storage_storage1").node.forEach((n) => {
//         siloData[n['$'].fillType] = n['$'].fillLevel;
//     });
//     let siloDataFlattened = flatten(siloData, 'farmSilo');
//     let tractorCount = data.vehicles.careerVehicles.vehicle.filter((v) => v['$'].filename.indexOf("steerable") !== -1).length;
//     let flatted = flatten(data);
//     Object.keys(flatted).forEach((key) => {
//         writeApi.writePoint(new Point(key).stringField('value', flatted[key]).timestamp(new Date()))
//     })
//     Object.keys(siloDataFlattened).forEach((key) => {
//         writeApi.writePoint(new Point(key).stringField('value', siloDataFlattened[key]).timestamp(new Date()))
//     })
//     writeApi.writePoint(new Point('tractorCount').intField('value', tractorCount).timestamp(new Date()));
    
//     // console.log(data);
//     // fs.writeFileSync('test.json', JSON.stringify())
// }
async function go(){
    await getData();
    writeApi.close().then(() => {
        console.log("FINISHED");
    });
}
go();
