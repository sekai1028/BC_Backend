import mongoose from 'mongoose'

const mercyPotSchema = new mongoose.Schema({
  total: {
    type: Number,
    default: 0.0
  },
  velocity: {
    type: Number,
    default: 0.0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'mercypot'
})

// Singleton pattern - only one document
mercyPotSchema.statics.getInstance = async function() {
  let instance = await this.findOne()
  if (!instance) {
    instance = await this.create({})
  }
  return instance
}

export default mongoose.model('MercyPot', mercyPotSchema)
