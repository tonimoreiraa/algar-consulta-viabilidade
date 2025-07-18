import axios from 'axios';
import xlsx from 'node-xlsx';
import fs from 'fs/promises'
import cliProgress from 'cli-progress'
import { gerarToken } from './gerar-token.js'

const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

/**
 * Exporta um array de objetos para um arquivo XLSX
 * @param {Array<Object>} data - Array de objetos com qualquer estrutura
 * @param {string} filename - Nome do arquivo de saída (ex: 'dados.xlsx')
 * @param {string} sheetName - Nome da planilha (default: 'Planilha1')
 */
async function exportToXlsx(data, filename, sheetName = 'Planilha1') {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Dados inválidos: forneça um array de objetos não vazio.');
  }

  // Coletar todas as chaves únicas
  const allHeaders = [...new Set(data.flatMap(obj => Object.keys(obj)))];

  // Criar as linhas com valores alinhados aos headers
  const rows = data.map(obj =>
    allHeaders.map(header => obj[header] ?? '')
  );

  // Montar os dados da planilha
  const worksheetData = [allHeaders, ...rows];

  // Gerar o buffer XLSX
  const buffer = xlsx.build([{ name: sheetName, data: worksheetData }]);

  // Salvar arquivo
  await fs.writeFile(filename, buffer);
}
async function readData()
{
    const fileName ='./input.xlsx'
    const worksheet = xlsx.parse(fileName);
    const sheet = worksheet[0].data
    const headers = sheet[0]
    const data = sheet.slice(1)
        .map(row => Object.fromEntries(
            row.map((col, i) => [headers[i], col])
        ))

    return data;
}

async function readAccessToken()
{
    const file = await fs.readFile('./tokens.json')
    const data = JSON.parse(file.toString('utf-8'))

    return data;
}

readAccessToken()

const urls = {
    getCep: 'https://viabilidade.algartelecom.com.br/portalviabilidade/telecom/location-management/geographic-information/v1/streets',
    broadBand: 'https://viabilidade.algartelecom.com.br/portalviabilidade/telecom/qualidade/feasibility/v2/broadband',
    region: 'https://viabilidade.algartelecom.com.br/portalviabilidade/telecom/location-management/geographic-information/v1/regions'
}

export async function main()
{
    const data = await readData()
    const newPayload = []
    progress.start(data.length, 0)
    for (const index in data) {
        const { access_token } = await readAccessToken()
        if (index % 15 === 0) {
            console.log(`Action at index: ${index}`);
            try {
                await gerarToken()
            } catch (e) {
                console.log('Falha ao renovar token')
            }
        }
        const headers = {
            access_token: access_token,
            client_id: "f20f3341-7f18-328d-a6a5-eec07b8340d7",
            Referer: "https://viabilidade.algartelecom.com.br/portalviabilidade/"
        }
        try {
            progress.update(Number(index));
            const row = data[index];
            // Filter only numbers from CEP and format as XXXXX-XXX
            const cepNumbers = String(row.CEP).replace(/\D/g, '');
            const formattedCep = cepNumbers.replace(/^(\d{5})(\d{3})$/, '$1-$2');

            const cepResponse = await axios.get(urls.getCep, {
                headers,
                params: { postCode: formattedCep }
            })
            const cep = cepResponse.data[0]

            const regionResponse = await axios.get(urls.region, {
                params: { localityCode: cep.locality.code },
                headers
            })

            const region = regionResponse.data[0]
            const address = {
                streetName: `${cep.type.code} ${cep.name}`,
                neighborhood: cep.neighbourhoods[0].name,
                locality: cep.locality.name,
                number: row['Número'],
                region: region.name,
                zipCode: String(row.CEP),
                geographicCoordinates: {
                    latitude: "",
                    longitude: ""
                },
                state: cep.locality.state,
                complement1: "",
                complement2: "",
                complement3: "",
                addressCode: ""
            }

            const now = new Date();
            const gatewayTime = now.toISOString().slice(0, 19); // "YYYY-MM-DDTHH:mm:ss"

            const broadbandResponse = await axios.post(urls.broadBand,
            {
                protocol: "10072025145527",
                client: {
                circuit: "",
                documentNumber: "",
                phone: "",
                address,
                contactPhone: String(row.Telefone).replace(/\D/g, ''),
                clientName: row.Nome,
                leadSpeed: "300",
                queryType: "INTERESTED_CUSTOMER"
                },
                originSystem: "SCREEN",
                originGateway: "API_SENSEDIA",
                gatewayTime: gatewayTime,
                viabilityId: "be95650a-54e1-ca3b-5c04-20b18eddbeb5",
                userLogin: "silvanako",
                isDeviceMobile: false,
                deviceInfo: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
            }, { headers })

            const products = Object.fromEntries(
                broadbandResponse.data.technologyViabilities.map(tech => [tech.type, tech.statusTechnology.message])
            )

            newPayload.push({...row, ...products})
            exportToXlsx(newPayload, './Output.xlsx', 'Sheet1')
        } catch (e) {
            console.log(e)
            newPayload.push(row)
        }
    }
    exportToXlsx(newPayload, './Output.xlsx', 'Sheet1')
}

main()