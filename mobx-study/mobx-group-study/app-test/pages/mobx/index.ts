



import {store} from './store'
import { autorun } from './autorun'



autorun(() => {
    console.log(store.a, 'autoRun打印')
})

store.increateA()





