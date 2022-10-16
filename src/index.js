const {
  BaseKonnector,
  requestFactory,
  scrape,
  log,
  utils,
  cozyClient
} = require('cozy-konnector-libs')

const models = cozyClient.new.models
const { Qualification } = models.document

const request = requestFactory({
  // The debug mode shows all the details about HTTP requests and responses. Very useful for
  // debugging but very verbose. This is why it is commented out by default
  // debug: true,
  // Activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // This allows request-promise to keep cookies between requests
  jar: true
})

const VENDOR = 'nourrircommelanature.com'
const baseUrl = 'https://www.nourrircommelanature.com'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
// cozyParameters are static parameters, independents from the account. Most often, it can be a
// secret api key.
async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')
  await authenticate.bind(this)(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/mes-commandes`)
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', documents)
  // Here we use the saveBills function even if what we fetch are not bills,
  // but this is the most common case in connectors
  log('info', 'Saving data to Cozy')
  await this.saveBills(documents, fields, {
    // This is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    contentType: 'application/pdf',
    identifiers: ['dog', 'mornant'] // The operation title is "original dog mornant"
  })
}

// This shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
function authenticate(username, password) {
  log('info', `login go! ${username} / ${password}`)
  return this.signin({
    url: `${baseUrl}/mon-compte`,
    formSelector: 'form#form_formidentification',
    formData: {
      veriflogin: 1,
      formlogin: username,
      formpass: password
    },
    validate: (_statusCode, _$, fullResponse) => {
      // The login is known as successful when we are redirected to '/espace-client'
      return fullResponse.request.uri.href == `${baseUrl}/espace-client`
    }
  })
}

// The goal of this function is to parse a HTML page wrapped by a cheerio instance
// and return an array of JS objects which will be saved to the cozy by saveBills
// (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($) {
  // You can find documentation about the scrape function here:
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  // log('info', $('div#liste_commande').html())
  const docs = scrape(
    $,
    {
      invoiceNumber: '.col1 span:last-child',
      date: {
        sel: '.col2 span:last-child',
        parse: str => parseDate(str.split(' ')[1]) // Format: "le 16/10/2022 à 11:25:22"
      },
      amount: {
        sel: '.col4 span:last-child',
        parse: str => Number.parseFloat(str.split(' ')[0].replace(',', '.'))
      },
      fileurl: {
        sel: '.col5 .font10 a[target=_blank]',
        attr: 'href',
        parse: url => {
          const commandNbr = url.split('commande=')[1]
          return `${baseUrl}/ma-facture/telecharger/?commande=${commandNbr}`
        }
      }
    },
    'div.article_panier'
  )

  return docs.map(doc => ({
    ...doc,
    currency: 'EUR',
    filename: `${utils.formatDate(doc.date)}-${doc.invoiceNumber}.pdf`,
    vendor: VENDOR,
    fileAttributes: {
      metadata: {
        invoiceNumber: doc.invoiceNumber,
        contentAuthor: VENDOR,
        datetime: utils.formatDate(doc.date),
        datetimeLabel: `issueDate`,
        carbonCopy: true,
        qualification: Qualification.getByLabel('grocery_invoice'),
        isSubscription: false
      }
    }
  }))
}

function parseDate(rawDate) {
  var date = new Date()

  date.setYear(rawDate.split('/')[2])
  date.setMonth(Number(rawDate.split('/')[1]) - 1, rawDate.split('/')[0]) // The months start to 0

  return date
}
