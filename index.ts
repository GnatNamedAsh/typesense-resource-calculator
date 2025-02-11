import { Client } from 'typesense'

// create a map of the field types to their memory usage
// here are some of the types we need to support. Don't worry
// if the type is unable to determine a memory amount, we'll dynamically
// handle those cases later.

const fieldTypeMemoryUsage = {
  string: 1, // 1 byte per character
  int32: 4, // 4 bytes
  float: 4, // 4 bytes
  bool: 1, // 1 byte
  object: 1, // we will dynamically calculate this later by either summing the memory usage of the fields or by using the size of the JSON object
  int64: 8, // 8 bytes
  auto: 1, // we will dynamically calculate this later by either summing the memory usage of the fields or by using the size of the JSON object
  "string[]": 1, // 1 byte per character in each element
  "bool[]": 1, // 1 byte per element in the array
  "int64[]": 1, // 8 bytes * the length of the array
  "float[]": 1, // 4 bytes * the length of the array
  "auto[]": 1, // // each element is the stringify of the element * 1, then summed up for the length of the array
  'object[]': 1, // each element is the stringify of the object * 1, then summed up for the length of the array
}

type ParsedCollection = {
  name: string
  indexedFields: {
    name: string
    type: string
  }[]
}

const typeSenseClient = new Client({
  nodes: [
    {
      host: process.env.TYPESENSE_HOST!,
      port: parseInt(process.env.TYPESENSE_PORT!),
      protocol: process.env.TYPESENSE_PROTOCOL!,
    },
  ],
  apiKey: process.env.TYPESENSE_API_KEY!,
})

const getParsedCollections = async () => {
  const collections = await typeSenseClient.collections().retrieve()
  return collections.map((collection) => {
    return {
      name: collection.name,
      indexedFields: collection.fields?.filter((field) => field.index || field.index === undefined).map((field) => {
        return {
          name: field.name,
          type: field.type,
        }
      }) || [],
    }
  })
}

const getMemoryUsageForCollection = async (collection: ParsedCollection) => {
  // typesense considers fields indexed if they are true or undefined
  const documents = (await typeSenseClient.collections(collection.name).documents().export({
    include_fields: collection.indexedFields.map((field) => field.name).join(','),
  })).split('\n').map((line) => {
    return JSON.parse(line)
  })

  // got through each document compared to the fieldTypeMemoryUsage map
  // and sum the memory usage of the fields, then average it by the number of documents
  // to get the average memory usage per document for this colleciton
  // the way this will work is this:
  // 1. got through each document, check if the key is in the collection.indexedFields array
  // 2. if it is, add the memory usage of the field to the total memory usage
  // 3. divide the total memory usage by the number of documents to get the average memory usage per document
  // 4. return the average memory usage per document

  let totalMemoryUsage = 0
  let lowestMemoryUsage = Infinity
  let highestMemoryUsage = 0
  const perDocumentMemoryUsages: number[] = []
  documents.forEach((document) => {
    let documentMemoryUsage = 0
    collection.indexedFields.forEach((field) => {
      const { name, type } = field
      let fieldMemoryUsage = 0
      if (document[name]) {
        switch (type) {
          case 'string':
            fieldMemoryUsage = document[name].length * fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            break
          case 'int32':
            fieldMemoryUsage = fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            break
          case 'float':
            fieldMemoryUsage = fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            break
          case 'bool':
            fieldMemoryUsage = fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            break
          case 'object':
            // we can't know the memory usage of an object, so we'll just use the size of the JSON string
            fieldMemoryUsage = JSON.stringify(document[name]).length * fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            break
          case 'int64':
            fieldMemoryUsage = fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            break
          case 'auto':
            // we can't know the memory usage of an auto field, so we'll just use the size of the JSON string
            fieldMemoryUsage = JSON.stringify(document[name]).length * fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            break
          case 'auto[]':
            // we can't know the memory usage of an auto field, so we'll just use the size of the JSON string
            fieldMemoryUsage = (document[name].reduce((acc: number, element: any) => {
              return acc + JSON.stringify(element).length * fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            }, 0) as number)
            break
          case 'object[]':
            // we can't know the memory usage of an object, so we'll just use the size of the JSON string
            fieldMemoryUsage = (document[name].reduce((acc: number, element: any) => {
              return acc + JSON.stringify(element).length * fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            }, 0) as number)
            break
          default:
            // assuming the rest of the types are arrays, we'll just use the length of the array * the memory usage of the type
            fieldMemoryUsage = document[name].length * fieldTypeMemoryUsage[type as keyof typeof fieldTypeMemoryUsage]
            break
        }
        if (Number.isNaN(fieldMemoryUsage)) {
          console.log(`${name}: ${fieldMemoryUsage}`)
          throw new Error('Document memory usage is NaN')
        }
      }
      documentMemoryUsage += fieldMemoryUsage
      totalMemoryUsage += fieldMemoryUsage
    })
    if (documentMemoryUsage < lowestMemoryUsage) {
      lowestMemoryUsage = documentMemoryUsage
    }
    if (documentMemoryUsage > highestMemoryUsage) {
      highestMemoryUsage = documentMemoryUsage
    }
    perDocumentMemoryUsages.push(documentMemoryUsage)
  })
  
  const averageMemoryUsage = totalMemoryUsage / documents.length
  const standardDeviation = Math.sqrt(perDocumentMemoryUsages.reduce((acc, documentMemoryUsage) => {
    return acc + (documentMemoryUsage - averageMemoryUsage) ** 2
  }, 0) / perDocumentMemoryUsages.length)
  const medianMemoryUsage = perDocumentMemoryUsages.sort((a, b) => a - b)[Math.floor(perDocumentMemoryUsages.length / 2)]

  return {
    average: averageMemoryUsage,
    standardDeviation,
    lowest: lowestMemoryUsage,
    highest: highestMemoryUsage,
    median: medianMemoryUsage,
    perDocument: perDocumentMemoryUsages,
    total: totalMemoryUsage,
  }
}

const run = async () => {
  const collections = await getParsedCollections()
  const memoryUsages = await Promise.all(collections.map(getMemoryUsageForCollection))
  // map the collections to their memory usages
  const collectionsWithMemoryUsages = collections.map((collection, index) => {
    return {
      ...collection,
      memoryUsage: memoryUsages[index],
    }
  })

  // sort the collections by memory usage
  const sortedCollections = collectionsWithMemoryUsages.sort((a, b) => b.memoryUsage.total - a.memoryUsage.total)

  // convert the memory usage to MB and GB
  // print the collections by memory usage
  sortedCollections.forEach((collection, index) => {
    const totalMemoryUsage = collection.memoryUsage.total
    const totalMemoryUsageInMB = totalMemoryUsage / (1024 ** 2)
    const totalMemoryUsageInGB = totalMemoryUsage / (1024 ** 3)
    // going to compensate for the fact that we don't know the memory usage of the objects in the array
    const recommendedMemoryUsage = totalMemoryUsage * 3.2 / (1024 ** 2)
    if (index === 0) console.log('\x1b[36m%s\x1b[0m', '-'.repeat(100))
    console.log('\x1b[32m%s\x1b[0m', `${collection.name}: ${totalMemoryUsageInMB.toFixed(2)} MB (${totalMemoryUsageInGB.toFixed(2)} GB)`)
    console.log('\x1b[33m%s\x1b[0m', `Recommended memory usage: ${recommendedMemoryUsage.toFixed(2)} MB`)
    console.log('\x1b[33m%s\x1b[0m', `Average memory usage per document: ${collection.memoryUsage.average.toFixed(2)} bytes`)
    console.log('\x1b[33m%s\x1b[0m', `Median memory usage per document: ${collection.memoryUsage.median.toFixed(2)} bytes`)
    console.log('\x1b[33m%s\x1b[0m', `Standard deviation of memory usage per document: ${collection.memoryUsage.standardDeviation.toFixed(2)} bytes`)
    console.log('\x1b[36m%s\x1b[0m', '-'.repeat(100))
  })
}
run()
