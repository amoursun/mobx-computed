// 3注册全局过滤器
    Vue.filter('filter_n', function (value) {
        if(typeof value !== 'string') return value
        return (value || '').replace(/\\n/g, '  ')
     })
   
     var app2 = new Vue({
        el: '#log',
        data: {
            logs: window.logData,
            currentKey: '',
            currentHeaderKey: '',
            styleObject: {
                float: "right"
            }
        },
        methods: {
            focus (key) {
                if(key === this.currentKey) {
                    this.currentKey = ''
                    return 
                }
                this.currentKey = key;
            },
            focusHeader(name){
                 if(name === this.currentHeaderKey) {
                    this.currentKey = ''
                    this.currentHeaderKey = ''
                    return 
                }
                this.currentHeaderKey = name
            }
        },
        noLog: true,
        template: `<div class="log log-info">
                <div v-for="item in logs" class="log-item">
                    <div v-bind:class="item.name.indexOf('创建一个fiber') > 0 ? 'fiber-box' 
                            : item.name.indexOf('创建一个DOM') > 0  ? 'dom-box' 
                            : item.name.indexOf('异步调度') > 0  ? 'sync-box' 
                            :item.name.indexOf('Hooks调用') > 0  ?  'hooks-box' :'default-box'">
                        <div v-on:click="focusHeader(item.name)" class="log-title">
                            <span> {{item.name}}</span>
                                <span v-if="item.info" v-bind:style="styleObject" >→</span>
                        </div>
                    
                        <div v-show="currentHeaderKey === item.name" class="log-info-info">
                            <p v-if="(typeof item.info) === 'string'" class="string-info">{{item.info}}</p>
                            <p v-if="(typeof item.info) !== 'string'">
                                <div v-for="el in item.info"  class="info-obj">
                                    <p v-on:click="focus(el.key)"><span class="info-name log-sub-title" >{{el.key + ':'}}</span>
                                        <span v-if="el.value">→</span>
                                        <span class="code-type" v-show="el.type !== 'primary'">这是一个{{el.type}}</span>
                                    </p>
                                    <div class="code-info">
                                    <p v-show="currentKey === el.key || (el.value.length &&el.value.length < 20)" class="code">
                                        <span v-if="(typeof el.value) === 'function'">'这是一个Function'</span>
                                        <span>{{el.value|filter_n}}</span>
                                        
                                    </p>
                                    </div>
                                </div>
                            </p>
                        </div>
                    
                    </div>
                    
                </div>
            </div>`
    })